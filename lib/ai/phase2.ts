import { randomUUID } from "crypto";
import type { AIJob, Asset, Prisma } from "@prisma/client";
import { TIMELINE_STATE_KEY, applyTimelineOperations, buildTimelineState, serializeTimelineState } from "../timeline-legacy";
import type { TimelineOperation, TimelineState, TimelineTrack } from "../timeline-types";
import { sanitizeOverlayText } from "../sanitize";
import { prisma } from "../prisma";
import { appendTimelineRevision } from "../project-v2";
import { isSupportedLanguage } from "../languages";
import { runAsrQualityPipeline } from "./asr-quality";
import { resolveProviderForCapability } from "../models/provider-routing";
import { getFallbackProvider } from "../providers/registry";
import { previewTimelineOperationsWithValidation } from "../timeline-invariants";
import { assignSegmentIdsToWords, buildTranscriptSegmentsFromWords } from "../transcript/segmentation";

const CAPTION_STYLE_NAME = "HookForge Bold";

const CHAT_UNDO_STACK_KEY = "chatEditUndoStack";
const CHAT_UNDO_STACK_LIMIT = 12;
const VIDEO_INTELLIGENCE_UNDO_STACK_KEY = "phase2VideoUndoStack";
const VIDEO_INTELLIGENCE_UNDO_STACK_LIMIT = 20;
const PHASE2_QUALITY_THRESHOLDS = {
  eyeContactRealism: 0.86,
  matteStability: 0.88,
  multicamCutAccuracy: 0.83
} as const;

type VideoIntelligenceAction = "eye_contact" | "background" | "multicam";

type ChatUndoLineage = {
  projectId?: string;
  baseRevision?: number;
  baseTimelineHash?: string;
  appliedRevision?: number;
  appliedTimelineHash?: string;
};

type ChatUndoEntry = {
  token: string;
  timelineStateJson: string;
  createdAt: string;
  prompt: string;
  projectId?: string;
  lineage?: ChatUndoLineage;
};

type VideoUndoEntry = {
  token: string;
  timelineStateJson: string;
  createdAt: string;
  action: VideoIntelligenceAction;
  summary: string;
  projectId?: string;
  sourceJobId?: string;
  lineage?: ChatUndoLineage;
};

type MulticamSegmentLike = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string | null;
  confidenceAvg?: number | null;
};

type MulticamRecommendation = {
  segmentId: string;
  startMs: number;
  endMs: number;
  speakerLabel?: string | null;
  score: number;
  recommendedCamera: "camera_a" | "camera_b";
  strategy: "speaker_change" | "emphasis" | "balanced";
  reason: string;
  autoSwitchSuggestion: {
    fromMs: number;
    toMs: number;
    camera: "camera_a" | "camera_b";
    confidence: number;
  };
};

type EyeContactOperationPlan = {
  operations: TimelineOperation[];
  targetCount: number;
  quality: {
    realismScore: number;
    artifactRiskScore: number;
    threshold: number;
    passed: boolean;
  };
};

type BackgroundOperationPlan = {
  operations: TimelineOperation[];
  targetCount: number;
  model: string;
  fallbackModel: string | null;
  fallbackUsed: boolean;
  quality: {
    matteStabilityScore: number;
    edgeIntegrityScore: number;
    threshold: number;
    passed: boolean;
  };
};

type MulticamOperationPlan = {
  operations: TimelineOperation[];
  targetCount: number;
  recommendations: MulticamRecommendation[];
  quality: {
    cutAccuracyScore: number;
    threshold: number;
    passed: boolean;
  };
};

type GeneratedWord = {
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string;
  confidence: number;
};

type GeneratedSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

type LegacyProjectForAi = {
  id: string;
  userId: string;
  config: unknown;
  assets: Array<Pick<Asset, "id" | "slotKey" | "kind" | "durationSec">>;
};

type LinkedProjectContext = {
  projectV2: {
    id: string;
    workspaceId: string;
    legacyProjectId: string | null;
    createdByUserId: string | null;
    currentRevisionId: string | null;
  };
  legacyProject: LegacyProjectForAi;
};

type StylePack = {
  id: string;
  transitionType: "cut" | "crossfade" | "slide";
  transitionMs: number;
  zoomScale: number;
  musicVolume: number;
  brollInMs: number;
  brollDurationMs: number;
};

const stylePacks: Record<string, StylePack> = {
  punchy: {
    id: "punchy",
    transitionType: "cut",
    transitionMs: 90,
    zoomScale: 1.08,
    musicVolume: 0.28,
    brollInMs: 420,
    brollDurationMs: 980
  },
  cinematic: {
    id: "cinematic",
    transitionType: "crossfade",
    transitionMs: 220,
    zoomScale: 1.04,
    musicVolume: 0.24,
    brollInMs: 620,
    brollDurationMs: 1300
  },
  kinetic: {
    id: "kinetic",
    transitionType: "slide",
    transitionMs: 180,
    zoomScale: 1.12,
    musicVolume: 0.3,
    brollInMs: 360,
    brollDurationMs: 900
  }
};

const scriptByLanguage: Record<string, string[]> = {
  en: ["hook", "forge", "helps", "creators", "ship", "short", "videos", "fast", "with", "clear", "captions"],
  es: ["hookforge", "ayuda", "a", "creadores", "a", "publicar", "videos", "cortos", "con", "subtitulos", "claros"],
  fr: ["hookforge", "aide", "les", "createurs", "a", "publier", "des", "videos", "courtes", "avec", "sous-titres"],
  de: ["hookforge", "hilft", "kreativen", "kurze", "videos", "schnell", "mit", "klaren", "untertiteln", "zu", "erstellen"],
  it: ["hookforge", "aiuta", "i", "creatori", "a", "pubblicare", "video", "brevi", "con", "sottotitoli", "chiari"],
  pt: ["hookforge", "ajuda", "criadores", "a", "publicar", "videos", "curtos", "com", "legendas", "claras"],
  ja: ["hookforge", "creators", "short", "video", "captions", "fast", "workflow"],
  ko: ["hookforge", "creators", "short", "video", "captions", "fast", "workflow"],
  hi: ["hookforge", "creator", "short", "video", "captions", "fast", "workflow"],
  ar: ["hookforge", "creators", "short", "video", "captions", "fast", "workflow"]
};

const translateMap: Record<string, Record<string, string>> = {
  es: { hook: "gancho", helps: "ayuda", creators: "creadores", videos: "videos", fast: "rapido", captions: "subtitulos" },
  fr: { hook: "accroche", helps: "aide", creators: "createurs", videos: "videos", fast: "rapide", captions: "sous-titres" },
  de: { hook: "haken", helps: "hilft", creators: "kreativen", videos: "videos", fast: "schnell", captions: "untertitel" },
  it: { hook: "gancio", helps: "aiuta", creators: "creatori", videos: "video", fast: "veloce", captions: "sottotitoli" },
  pt: { hook: "gancho", helps: "ajuda", creators: "criadores", videos: "videos", fast: "rapido", captions: "legendas" }
};

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.trunc(parsed);
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function mergeStringRecord(base: Record<string, string>, override: Record<string, string>) {
  return {
    ...base,
    ...override
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundScore(value: number, digits = 3) {
  return Number(value.toFixed(digits));
}

function parseVideoUndoStack(config: Record<string, unknown>) {
  const raw = config[VIDEO_INTELLIGENCE_UNDO_STACK_KEY];
  if (!Array.isArray(raw)) {
    return [] as VideoUndoEntry[];
  }

  const parsed: VideoUndoEntry[] = [];
  for (const entry of raw) {
    const candidate = asRecord(entry);
    const action = asString(candidate.action) as VideoIntelligenceAction;
    const token = asString(candidate.token);
    const timelineStateJson = asString(candidate.timelineStateJson);
    const summary = asString(candidate.summary);
    if (!token || !timelineStateJson || !summary || !["eye_contact", "background", "multicam"].includes(action)) {
      continue;
    }

    const lineageRaw = asRecord(candidate.lineage);
    const lineage: ChatUndoLineage = {
      projectId: asString(lineageRaw.projectId) || undefined,
      baseRevision: asInteger(lineageRaw.baseRevision),
      baseTimelineHash: asString(lineageRaw.baseTimelineHash) || undefined,
      appliedRevision: asInteger(lineageRaw.appliedRevision),
      appliedTimelineHash: asString(lineageRaw.appliedTimelineHash) || undefined
    };
    const hasLineage = Object.values(lineage).some((value) => value !== undefined);

    parsed.push({
      action,
      token,
      summary,
      timelineStateJson,
      createdAt: asString(candidate.createdAt, new Date().toISOString()),
      projectId: asString(candidate.projectId) || undefined,
      sourceJobId: asString(candidate.sourceJobId) || undefined,
      ...(hasLineage ? { lineage } : {})
    });
  }

  return parsed;
}

function pushVideoUndoEntry(params: {
  config: Record<string, unknown>;
  action: VideoIntelligenceAction;
  undoToken: string;
  timelineStateJson: string;
  summary: string;
  projectId?: string;
  sourceJobId?: string;
  lineage?: ChatUndoLineage;
}) {
  const existing = parseVideoUndoStack(params.config);
  const next = [
    {
      action: params.action,
      token: params.undoToken,
      timelineStateJson: params.timelineStateJson,
      createdAt: new Date().toISOString(),
      summary: sanitizeOverlayText(params.summary, params.action),
      projectId: params.projectId,
      sourceJobId: params.sourceJobId,
      lineage: params.lineage
    },
    ...existing
  ].slice(0, VIDEO_INTELLIGENCE_UNDO_STACK_LIMIT);

  return {
    ...params.config,
    [VIDEO_INTELLIGENCE_UNDO_STACK_KEY]: next
  };
}

function consumeVideoUndoEntryWithLineage(params: {
  configInput: unknown;
  action: VideoIntelligenceAction;
  undoToken: string;
  projectId?: string;
  currentRevision?: number;
  currentTimelineHash?: string | null;
  requireLatestLineage?: boolean;
}): { entry: VideoUndoEntry; config: Record<string, unknown> } | { error: string } {
  const config = asRecord(params.configInput);
  const stack = parseVideoUndoStack(config);
  const index = stack.findIndex((entry) => entry.token === params.undoToken && entry.action === params.action);
  if (index === -1) {
    return { error: "Undo token not found" };
  }

  const entry = stack[index];
  if (!entry) {
    return { error: "Undo token not found" };
  }

  if (params.projectId && entry.projectId && entry.projectId !== params.projectId) {
    return { error: "Undo token does not belong to this project" };
  }

  if (params.requireLatestLineage) {
    if (!entry.lineage?.appliedRevision || !entry.lineage?.appliedTimelineHash) {
      return { error: "Undo token missing lineage metadata" };
    }
    if (typeof params.currentRevision === "number" && entry.lineage.appliedRevision !== params.currentRevision) {
      return { error: "Undo token no longer matches current timeline revision" };
    }
    if (params.currentTimelineHash && entry.lineage.appliedTimelineHash !== params.currentTimelineHash) {
      return { error: "Undo token no longer matches current timeline hash" };
    }
  }

  const remaining = [...stack.slice(0, index), ...stack.slice(index + 1)];
  return {
    entry,
    config: {
      ...config,
      [VIDEO_INTELLIGENCE_UNDO_STACK_KEY]: remaining
    }
  };
}

function listVideoClipTargets(state: TimelineState, clipIds?: string[]) {
  const clipIdSet = clipIds && clipIds.length > 0 ? new Set(clipIds) : null;
  const targets: Array<{
    trackId: string;
    clipId: string;
    timelineInMs: number;
    timelineOutMs: number;
  }> = [];

  for (const track of getVideoTracks(state)) {
    for (const clip of track.clips) {
      if (clipIdSet && !clipIdSet.has(clip.id)) {
        continue;
      }
      targets.push({
        trackId: track.id,
        clipId: clip.id,
        timelineInMs: clip.timelineInMs,
        timelineOutMs: clip.timelineOutMs
      });
    }
  }

  if (targets.length === 0 && !clipIdSet) {
    const fallbackTrack = getVideoTracks(state)[0];
    if (fallbackTrack?.clips[0]) {
      const first = fallbackTrack.clips[0];
      targets.push({
        trackId: fallbackTrack.id,
        clipId: first.id,
        timelineInMs: first.timelineInMs,
        timelineOutMs: first.timelineOutMs
      });
    }
  }

  return targets;
}

export function buildEyeContactOperations(params: {
  state: TimelineState;
  intensity: number;
  gazeTarget: "camera" | "slight_left" | "slight_right";
  clipIds?: string[];
}) {
  const intensity = clamp(params.intensity, 0, 1);
  const targets = listVideoClipTargets(params.state, params.clipIds).slice(0, 24);
  const operations: TimelineOperation[] = targets.map((target) => ({
    op: "upsert_effect",
    trackId: target.trackId,
    clipId: target.clipId,
    effectType: "eye_contact",
    config: {
      intensity: roundScore(intensity),
      gazeTarget: params.gazeTarget,
      model: "eyecontact_v2",
      preserveBlinkRate: true
    }
  }));

  const realismScore = clamp(
    0.95 - Math.abs(intensity - 0.62) * 0.42 - (targets.length > 14 ? 0.06 : 0) - (params.gazeTarget === "camera" ? 0 : 0.03),
    0.45,
    0.99
  );
  const artifactRiskScore = clamp(
    Math.max(0.01, (intensity - 0.82) * 1.4) + (targets.length > 18 ? 0.18 : 0),
    0.01,
    0.95
  );

  const plan: EyeContactOperationPlan = {
    operations,
    targetCount: targets.length,
    quality: {
      realismScore: roundScore(realismScore),
      artifactRiskScore: roundScore(artifactRiskScore),
      threshold: PHASE2_QUALITY_THRESHOLDS.eyeContactRealism,
      passed: realismScore >= PHASE2_QUALITY_THRESHOLDS.eyeContactRealism && artifactRiskScore <= 0.24
    }
  };

  return plan;
}

export function buildBackgroundOperations(params: {
  state: TimelineState;
  mode: "replace" | "blur" | "remove";
  backgroundAssetId?: string | null;
  strength: number;
  clipIds?: string[];
}) {
  const strength = clamp(params.strength, 0, 1);
  const targets = listVideoClipTargets(params.state, params.clipIds).slice(0, 24);
  const operations: TimelineOperation[] = [];
  const timelineDurationMs = estimateTimelineDurationMs(params.state, 3200);

  const fallbackUsed = params.mode === "replace" && !params.backgroundAssetId;
  const model = strength >= 0.72 ? "matte_pro_v3" : "matte_fast_v2";
  const fallbackModel = fallbackUsed ? "matte_blur_fallback_v1" : null;

  const layerTrack = findTrackByName(params.state, "VIDEO", "AI Background Layer");
  const layerTrackId = layerTrack?.id ?? randomUUID();
  if (!layerTrack) {
    operations.push({
      op: "create_track",
      trackId: layerTrackId,
      kind: "VIDEO",
      name: "AI Background Layer"
    });
  } else {
    for (const clip of layerTrack.clips) {
      operations.push({
        op: "remove_clip",
        trackId: layerTrack.id,
        clipId: clip.id
      });
    }
  }

  if (!fallbackUsed && params.backgroundAssetId) {
    operations.push({
      op: "add_clip",
      clipId: randomUUID(),
      trackId: layerTrackId,
      assetId: params.backgroundAssetId,
      label: "AI background layer",
      timelineInMs: 0,
      durationMs: timelineDurationMs
    });
  }

  for (const target of targets) {
    operations.push({
      op: "upsert_effect",
      trackId: target.trackId,
      clipId: target.clipId,
      effectType: params.mode === "replace" ? "green_screen" : params.mode === "blur" ? "background_blur" : "background_remove",
      config: {
        mode: fallbackUsed ? "blur" : params.mode,
        strength: roundScore(strength),
        model,
        fallbackModel,
        backgroundAssetId: params.backgroundAssetId ?? null
      }
    });
  }

  const matteStabilityScore = clamp(
    0.95 - Math.abs(strength - 0.72) * 0.42 - (fallbackUsed ? 0.08 : 0) - (params.mode === "remove" ? 0.03 : 0),
    0.45,
    0.99
  );
  const edgeIntegrityScore = clamp(
    matteStabilityScore - (strength > 0.9 ? 0.06 : 0) + (params.mode === "blur" ? 0.02 : 0),
    0.4,
    0.99
  );

  const plan: BackgroundOperationPlan = {
    operations,
    targetCount: targets.length,
    model,
    fallbackModel,
    fallbackUsed,
    quality: {
      matteStabilityScore: roundScore(matteStabilityScore),
      edgeIntegrityScore: roundScore(edgeIntegrityScore),
      threshold: PHASE2_QUALITY_THRESHOLDS.matteStability,
      passed: matteStabilityScore >= PHASE2_QUALITY_THRESHOLDS.matteStability && edgeIntegrityScore >= 0.82
    }
  };

  return plan;
}

export function buildMulticamRecommendations(params: {
  segments: MulticamSegmentLike[];
  maxRecommendations?: number;
}) {
  const safeMax = clamp(Math.floor(params.maxRecommendations ?? 8), 1, 20);
  const segments = [...params.segments].sort((a, b) => a.startMs - b.startMs);

  const recommendations: MulticamRecommendation[] = segments.map((segment, index) => {
    const durationMs = Math.max(1, segment.endMs - segment.startMs);
    const durationSec = durationMs / 1000;
    const wordCount = sanitizeOverlayText(segment.text, "")
      .split(/\s+/)
      .filter(Boolean).length;
    const wordsPerSec = wordCount / Math.max(0.35, durationSec);
    const prevSpeaker = index > 0 ? segments[index - 1]?.speakerLabel : null;
    const speakerShift = Boolean(prevSpeaker && segment.speakerLabel && prevSpeaker !== segment.speakerLabel);
    const emphasisCue = /[!?]|(however|but|now|listen|first|next|finally|important)/i.test(segment.text);
    const confidencePenalty = segment.confidenceAvg && segment.confidenceAvg < 0.85 ? (0.85 - segment.confidenceAvg) * 22 : 0;
    const pacingBoost = clamp((wordsPerSec - 2.6) * 6, 0, 20);
    const durationFit = 20 - clamp(Math.abs(durationMs - 1700) / 120, 0, 20);
    const score = clamp(
      42 + durationFit + pacingBoost + (speakerShift ? 18 : 0) + (emphasisCue ? 10 : 0) - confidencePenalty,
      1,
      99
    );
    const strategy = speakerShift ? "speaker_change" : emphasisCue ? "emphasis" : "balanced";
    const camera = speakerShift
      ? (String(segment.speakerLabel).length % 2 === 0 ? "camera_b" : "camera_a")
      : index % 2 === 0
        ? "camera_a"
        : "camera_b";
    const reason = speakerShift
      ? "Speaker transition detected with pacing shift."
      : emphasisCue
        ? "Transcript emphasis cue indicates a visual switch point."
        : "Balanced pacing and duration suggest a stable cut.";

    return {
      segmentId: segment.id,
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerLabel: segment.speakerLabel,
      score: roundScore(score, 2),
      recommendedCamera: camera,
      strategy,
      reason,
      autoSwitchSuggestion: {
        fromMs: segment.startMs,
        toMs: segment.endMs,
        camera,
        confidence: roundScore(score / 100)
      }
    };
  });

  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, safeMax);
}

export function buildMulticamApplyOperations(params: {
  state: TimelineState;
  strategy: "speaker_change" | "emphasis" | "balanced";
  segments: MulticamSegmentLike[];
}) {
  const recommendations = buildMulticamRecommendations({
    segments: params.segments,
    maxRecommendations: Math.max(1, params.segments.length)
  });

  const operations: TimelineOperation[] = [];
  const primaryTrack = getVideoTracks(params.state)[0];
  if (!primaryTrack || primaryTrack.clips.length === 0) {
    return {
      operations,
      targetCount: 0,
      recommendations,
      quality: {
        cutAccuracyScore: 0,
        threshold: PHASE2_QUALITY_THRESHOLDS.multicamCutAccuracy,
        passed: false
      }
    } as MulticamOperationPlan;
  }

  const transitionMs = params.strategy === "speaker_change" ? 80 : params.strategy === "emphasis" ? 120 : 96;
  const selectedClips = primaryTrack.clips.slice(0, Math.max(1, recommendations.length));
  for (let index = 0; index < selectedClips.length; index += 1) {
    const clip = selectedClips[index];
    const recommendation = recommendations[index];
    if (!recommendation) {
      continue;
    }
    operations.push({
      op: "set_transition",
      trackId: primaryTrack.id,
      clipId: clip.id,
      transitionType: "cut",
      durationMs: transitionMs
    });
    operations.push({
      op: "upsert_effect",
      trackId: primaryTrack.id,
      clipId: clip.id,
      effectType: "multicam_switch",
      config: {
        strategy: params.strategy,
        segmentId: recommendation.segmentId,
        camera: recommendation.recommendedCamera,
        score: recommendation.score
      }
    });
    operations.push({
      op: "set_clip_label",
      trackId: primaryTrack.id,
      clipId: clip.id,
      label: `Multicam ${recommendation.recommendedCamera.toUpperCase()}`
    });
  }

  const cutAccuracyScore = clamp(
    0.78 +
      Math.min(0.14, recommendations.length * 0.02) +
      (params.strategy === "speaker_change" ? 0.05 : params.strategy === "emphasis" ? 0.03 : 0.02) -
      (primaryTrack.clips.length < 2 ? 0.06 : 0),
    0.5,
    0.98
  );

  const plan: MulticamOperationPlan = {
    operations,
    targetCount: selectedClips.length,
    recommendations,
    quality: {
      cutAccuracyScore: roundScore(cutAccuracyScore),
      threshold: PHASE2_QUALITY_THRESHOLDS.multicamCutAccuracy,
      passed: cutAccuracyScore >= PHASE2_QUALITY_THRESHOLDS.multicamCutAccuracy
    }
  };

  return plan;
}

function chooseStylePack(styleId: string) {
  const normalized = styleId.trim().toLowerCase();
  if (stylePacks[normalized]) {
    return stylePacks[normalized];
  }
  if (normalized.includes("cine")) {
    return stylePacks.cinematic;
  }
  if (normalized.includes("kin")) {
    return stylePacks.kinetic;
  }
  return stylePacks.punchy;
}

function selectPrimaryVideoAsset(assets: LegacyProjectForAi["assets"]) {
  const videos = assets.filter((asset) => asset.kind === "VIDEO");
  if (videos.length === 0) {
    return null;
  }

  const priority = ["main", "foreground", "top", "bottom"];
  for (const slotKey of priority) {
    const match = videos.find((asset) => asset.slotKey === slotKey);
    if (match) {
      return match;
    }
  }

  return [...videos].sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0))[0];
}

function estimateTimelineDurationMs(state: TimelineState, fallbackMs: number) {
  let maxMs = 0;
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      maxMs = Math.max(maxMs, clip.timelineOutMs);
    }
  }
  return Math.max(fallbackMs, maxMs);
}

function clipDurationMs(clip: { timelineInMs: number; timelineOutMs: number }) {
  return Math.max(120, clip.timelineOutMs - clip.timelineInMs);
}

function findTrackByName(state: TimelineState, kind: TimelineTrack["kind"], name: string) {
  const lowered = name.trim().toLowerCase();
  return state.tracks.find((track) => track.kind === kind && track.name.trim().toLowerCase() === lowered);
}

function getVideoTracks(state: TimelineState) {
  return state.tracks
    .filter((track) => track.kind === "VIDEO")
    .sort((a, b) => a.order - b.order);
}

function getAudioTracks(state: TimelineState) {
  return state.tracks
    .filter((track) => track.kind === "AUDIO")
    .sort((a, b) => a.order - b.order);
}

function getCaptionTracks(state: TimelineState) {
  return state.tracks
    .filter((track) => track.kind === "CAPTION")
    .sort((a, b) => a.order - b.order);
}

function normalizeWord(word: string) {
  return word.replace(/[^a-zA-Z0-9']/g, "").toLowerCase();
}

function maybePunctuate(text: string, punctuationStyle: string) {
  if (punctuationStyle === "minimal") {
    return text;
  }
  if (punctuationStyle === "full" && !/[.!?]$/.test(text)) {
    return `${text}.`;
  }
  return text;
}

function generateDeterministicTranscript(params: {
  language: string;
  durationMs: number;
  diarization: boolean;
  punctuationStyle: string;
}) {
  const language = params.language.toLowerCase();
  const baseWords = scriptByLanguage[language] ?? scriptByLanguage.en;
  const wordCount = Math.max(8, Math.min(80, Math.floor(params.durationMs / 360)));
  const slotMs = Math.max(120, Math.floor(params.durationMs / wordCount));
  const words: GeneratedWord[] = [];
  let cursor = 0;

  for (let index = 0; index < wordCount; index += 1) {
    const token = baseWords[index % baseWords.length];
    const cleaned = sanitizeOverlayText(token, "word");
    const startMs = cursor;
    const endMs = Math.min(params.durationMs, cursor + slotMs);
    words.push({
      startMs,
      endMs: Math.max(startMs + 90, endMs),
      text: cleaned,
      speakerLabel: params.diarization ? (index % 2 === 0 ? "Speaker 1" : "Speaker 2") : undefined,
      confidence: 0.94
    });
    cursor = endMs;
  }

  const segments: GeneratedSegment[] = [];
  const segmentSize = 6;
  for (let i = 0; i < words.length; i += segmentSize) {
    const chunk = words.slice(i, i + segmentSize);
    const text = sanitizeOverlayText(chunk.map((word) => word.text).join(" "), "caption");
    if (!text) {
      continue;
    }
    segments.push({
      startMs: chunk[0].startMs,
      endMs: chunk[chunk.length - 1].endMs,
      text: maybePunctuate(text, params.punctuationStyle)
    });
  }

  return { words, segments };
}

function translateTextDeterministic(params: {
  text: string;
  targetLanguage: string;
  tone?: string;
  glossary?: Record<string, string>;
}) {
  const safeText = sanitizeOverlayText(params.text, "");
  if (!safeText) {
    return "";
  }
  if (params.targetLanguage === "en") {
    return safeText;
  }

  const glossary = params.glossary ?? {};
  const dictionary = translateMap[params.targetLanguage] ?? {};
  const translated = safeText
    .split(/\s+/)
    .map((word) => {
      const normalized = normalizeWord(word);
      if (normalized && glossary[normalized]) {
        return glossary[normalized];
      }
      if (normalized && dictionary[normalized]) {
        return dictionary[normalized];
      }
      return word;
    })
    .join(" ");

  const toned = params.tone && params.tone.toLowerCase().includes("casual") ? `${translated} :)` : translated;
  return sanitizeOverlayText(`[${params.targetLanguage.toUpperCase()}] ${toned}`, `[${params.targetLanguage.toUpperCase()}] ${safeText}`);
}

function parseUndoStack(config: Record<string, unknown>) {
  const raw = config[CHAT_UNDO_STACK_KEY];
  if (!Array.isArray(raw)) {
    return [] as ChatUndoEntry[];
  }

  const parsed: ChatUndoEntry[] = [];
  for (const entry of raw) {
    const candidate = asRecord(entry);
    const token = asString(candidate.token);
    const timelineStateJson = asString(candidate.timelineStateJson);
    const createdAt = asString(candidate.createdAt);
    const prompt = asString(candidate.prompt);
    const projectId = asString(candidate.projectId) || undefined;
    const lineageRaw = asRecord(candidate.lineage);

    if (!token || !timelineStateJson) {
      continue;
    }

    const lineage: ChatUndoLineage = {
      projectId: asString(lineageRaw.projectId) || undefined,
      baseRevision: asInteger(lineageRaw.baseRevision),
      baseTimelineHash: asString(lineageRaw.baseTimelineHash) || undefined,
      appliedRevision: asInteger(lineageRaw.appliedRevision),
      appliedTimelineHash: asString(lineageRaw.appliedTimelineHash) || undefined
    };

    const hasLineage = Object.values(lineage).some((value) => value !== undefined);
    parsed.push({
      token,
      timelineStateJson,
      createdAt,
      prompt,
      ...(projectId ? { projectId } : {}),
      ...(hasLineage ? { lineage } : {})
    });
  }

  return parsed;
}

export function pushChatUndoEntry(params: {
  config: Record<string, unknown>;
  undoToken: string;
  timelineStateJson: string;
  prompt: string;
  projectId?: string;
  lineage?: ChatUndoLineage;
}) {
  const existing = parseUndoStack(params.config);
  const next = [
    {
      token: params.undoToken,
      timelineStateJson: params.timelineStateJson,
      createdAt: new Date().toISOString(),
      prompt: sanitizeOverlayText(params.prompt, ""),
      projectId: params.projectId,
      lineage: params.lineage
    },
    ...existing
  ].slice(0, CHAT_UNDO_STACK_LIMIT);

  return {
    ...params.config,
    [CHAT_UNDO_STACK_KEY]: next
  };
}

export function consumeChatUndoEntryWithLineage(params: {
  configInput: unknown;
  undoToken: string;
  projectId?: string;
  currentRevision?: number;
  currentTimelineHash?: string | null;
  requireLatestLineage?: boolean;
}): { entry: ChatUndoEntry; config: Record<string, unknown> } | { error: string } {
  const config = asRecord(params.configInput);
  const stack = parseUndoStack(config);
  const index = stack.findIndex((entry) => entry.token === params.undoToken);
  if (index === -1) {
    return { error: "Undo token not found" };
  }

  const entry = stack[index];
  if (!entry) {
    return { error: "Undo token not found" };
  }

  if (params.projectId && entry.projectId && entry.projectId !== params.projectId) {
    return { error: "Undo token does not belong to this project" };
  }

  if (params.requireLatestLineage) {
    if (!entry.lineage?.appliedRevision || !entry.lineage?.appliedTimelineHash) {
      return { error: "Undo token missing lineage metadata" };
    }
    if (typeof params.currentRevision === "number" && entry.lineage.appliedRevision !== params.currentRevision) {
      return { error: "Undo token no longer matches current timeline revision" };
    }
    if (params.currentTimelineHash && entry.lineage.appliedTimelineHash !== params.currentTimelineHash) {
      return { error: "Undo token no longer matches current timeline hash" };
    }
  }

  const remaining = [...stack.slice(0, index), ...stack.slice(index + 1)];
  return {
    entry,
    config: {
      ...config,
      [CHAT_UNDO_STACK_KEY]: remaining
    }
  };
}

export function consumeChatUndoEntry(configInput: unknown, undoToken: string) {
  const consumed = consumeChatUndoEntryWithLineage({
    configInput,
    undoToken
  });
  if ("error" in consumed) {
    return null;
  }
  return consumed;
}

async function loadLinkedProjectContext(projectV2Id: string): Promise<LinkedProjectContext | null> {
  const projectV2 = await prisma.projectV2.findUnique({
    where: { id: projectV2Id },
    select: {
      id: true,
      workspaceId: true,
      legacyProjectId: true,
      createdByUserId: true,
      currentRevisionId: true
    }
  });

  if (!projectV2?.legacyProjectId) {
    return null;
  }

  const legacyProject = await prisma.project.findUnique({
    where: { id: projectV2.legacyProjectId },
    select: {
      id: true,
      userId: true,
      config: true,
      assets: {
        select: {
          id: true,
          slotKey: true,
          kind: true,
          durationSec: true
        }
      }
    }
  });

  if (!legacyProject) {
    return null;
  }

  return {
    projectV2,
    legacyProject
  };
}

async function ensureCaptionStylePreset(workspaceId: string) {
  const existing = await prisma.captionStylePreset.findFirst({
    where: {
      workspaceId,
      name: CAPTION_STYLE_NAME
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.captionStylePreset.create({
    data: {
      workspaceId,
      name: CAPTION_STYLE_NAME,
      config: {
        fontSize: 42,
        fontWeight: 700,
        bgOpacity: 0.72,
        position: "bottom_center"
      },
      isSystem: true
    }
  });
}

function toTimelineAssetShape(assets: LegacyProjectForAi["assets"]) {
  return assets.map((asset) => ({
    id: asset.id,
    slotKey: asset.slotKey,
    kind: asset.kind,
    durationSec: asset.durationSec
  }));
}

async function persistTimelineToLegacyProject(params: {
  legacyProjectId: string;
  config: unknown;
  timeline: TimelineState;
}) {
  const configRecord = asRecord(params.config);
  const merged = serializeTimelineState(configRecord, params.timeline);
  await prisma.project.update({
    where: { id: params.legacyProjectId },
    data: {
      config: merged as Prisma.InputJsonValue
    }
  });
}

function ensureCaptionTrackOps(params: {
  state: TimelineState;
  trackName: string;
}) {
  const existing = findTrackByName(params.state, "CAPTION", params.trackName);
  if (existing) {
    return { trackId: existing.id, operations: [] as TimelineOperation[] };
  }

  const trackId = randomUUID();
  return {
    trackId,
    operations: [
      {
        op: "create_track",
        trackId,
        kind: "CAPTION",
        name: params.trackName
      }
    ] as TimelineOperation[]
  };
}

function buildReplaceCaptionTrackOperations(params: {
  state: TimelineState;
  trackName: string;
  segments: GeneratedSegment[];
}) {
  const trackInfo = ensureCaptionTrackOps({
    state: params.state,
    trackName: params.trackName
  });
  const track = params.state.tracks.find((entry) => entry.id === trackInfo.trackId);

  const operations: TimelineOperation[] = [...trackInfo.operations];
  if (track) {
    for (const clip of track.clips) {
      operations.push({
        op: "remove_clip",
        trackId: track.id,
        clipId: clip.id
      });
    }
  }

  for (const segment of params.segments) {
    const clipId = randomUUID();
    operations.push({
      op: "add_clip",
      clipId,
      trackId: trackInfo.trackId,
      label: sanitizeOverlayText(segment.text, "caption"),
      timelineInMs: Math.max(0, segment.startMs),
      durationMs: Math.max(120, segment.endMs - segment.startMs),
      sourceInMs: 0,
      sourceOutMs: Math.max(120, segment.endMs - segment.startMs)
    });
    operations.push({
      op: "upsert_effect",
      trackId: trackInfo.trackId,
      clipId,
      effectType: "caption_style",
      config: {
        fontSize: 42,
        bgOpacity: 0.72,
        radius: 16
      }
    });
  }

  return { trackId: trackInfo.trackId, operations };
}

function buildAiEditOperations(params: {
  state: TimelineState;
  assets: LegacyProjectForAi["assets"];
  stylePack: StylePack;
  includeBroll: boolean;
  includeMusic: boolean;
  includeSfx: boolean;
}) {
  const operations: TimelineOperation[] = [];
  const primaryVideoTrack = getVideoTracks(params.state)[0];
  const audioTracks = getAudioTracks(params.state);
  const timelineDurationMs = estimateTimelineDurationMs(params.state, 3000);

  if (primaryVideoTrack) {
    for (const clip of primaryVideoTrack.clips.slice(0, 3)) {
      operations.push({
        op: "set_transition",
        trackId: primaryVideoTrack.id,
        clipId: clip.id,
        transitionType: params.stylePack.transitionType,
        durationMs: params.stylePack.transitionMs
      });
    }
    const firstClip = primaryVideoTrack.clips[0];
    if (firstClip) {
      operations.push({
        op: "upsert_effect",
        trackId: primaryVideoTrack.id,
        clipId: firstClip.id,
        effectType: "transform",
        config: {
          scale: params.stylePack.zoomScale,
          x: 0.5,
          y: 0.5
        }
      });
    }
  }

  if (params.includeMusic) {
    const existingTrack = findTrackByName(params.state, "AUDIO", "AI Music Track");
    const musicTrackId = existingTrack?.id ?? randomUUID();
    if (!existingTrack) {
      operations.push({ op: "create_track", trackId: musicTrackId, kind: "AUDIO", name: "AI Music Track" });
    }
    operations.push({
      op: "add_clip",
      clipId: randomUUID(),
      trackId: musicTrackId,
      slotKey: "library:music-bed",
      label: "AI music bed",
      timelineInMs: 0,
      durationMs: Math.max(1600, timelineDurationMs)
    });
    operations.push({
      op: "set_track_audio",
      trackId: musicTrackId,
      volume: params.stylePack.musicVolume
    });
  }

  if (params.includeSfx) {
    const existingTrack = findTrackByName(params.state, "AUDIO", "AI SFX Track");
    const sfxTrackId = existingTrack?.id ?? randomUUID();
    if (!existingTrack) {
      operations.push({ op: "create_track", trackId: sfxTrackId, kind: "AUDIO", name: "AI SFX Track" });
    }

    operations.push({
      op: "add_clip",
      clipId: randomUUID(),
      trackId: sfxTrackId,
      slotKey: "library:sfx-boom",
      label: "AI impact boom",
      timelineInMs: 0,
      durationMs: 420
    });
    operations.push({
      op: "add_clip",
      clipId: randomUUID(),
      trackId: sfxTrackId,
      slotKey: "library:sfx-notify",
      label: "AI notify",
      timelineInMs: 1200,
      durationMs: 520
    });
    operations.push({
      op: "set_track_audio",
      trackId: sfxTrackId,
      volume: 0.88
    });
  }

  if (params.includeBroll) {
    const brollAsset = params.assets.find(
      (asset) =>
        (asset.kind === "VIDEO" || asset.kind === "IMAGE") &&
        !["main", "foreground", "top", "bottom"].includes(asset.slotKey)
    );

    if (brollAsset) {
      const existingTrack = findTrackByName(params.state, "VIDEO", "AI B-roll Track");
      const brollTrackId = existingTrack?.id ?? randomUUID();
      if (!existingTrack) {
        operations.push({ op: "create_track", trackId: brollTrackId, kind: "VIDEO", name: "AI B-roll Track" });
      }
      const clipId = randomUUID();
      operations.push({
        op: "add_clip",
        clipId,
        trackId: brollTrackId,
        assetId: brollAsset.id,
        slotKey: brollAsset.slotKey,
        label: "AI B-roll",
        timelineInMs: params.stylePack.brollInMs,
        durationMs: params.stylePack.brollDurationMs
      });
      operations.push({
        op: "upsert_effect",
        trackId: brollTrackId,
        clipId,
        effectType: "transform",
        config: {
          x: 0.5,
          y: 0.5,
          widthPct: 0.72,
          heightPct: 0.42,
          radius: 18,
          opacity: 0.92
        }
      });
    }
  }

  for (const audioTrack of audioTracks) {
    operations.push({
      op: "set_track_audio",
      trackId: audioTrack.id,
      volume: Math.min(audioTrack.volume, 0.74)
    });
  }

  return operations;
}

async function handleTranscribeJob(aiJob: AIJob) {
  if (!aiJob.projectId) {
    return { note: "No project attached to transcription job." };
  }

  const context = await loadLinkedProjectContext(aiJob.projectId);
  if (!context) {
    return { note: "Linked project context not found." };
  }

  const input = asRecord(aiJob.input);
  const requestedLanguage = asString(input.language, "en").toLowerCase();
  const language = isSupportedLanguage(requestedLanguage) ? requestedLanguage : "en";
  const diarization = asBoolean(input.diarization, false);
  const punctuationStyleRaw = asString(input.punctuationStyle, "auto");
  const punctuationStyle: "auto" | "minimal" | "full" =
    punctuationStyleRaw === "minimal" || punctuationStyleRaw === "full" ? punctuationStyleRaw : "auto";
  const confidenceThreshold = asNumber(input.confidenceThreshold, 0.86);
  const reDecodeEnabled = asBoolean(input.reDecodeEnabled, true);
  const maxWordsPerSegment = asNumber(input.maxWordsPerSegment, 7);
  const maxCharsPerLine = asNumber(input.maxCharsPerLine, 24);
  const maxLinesPerSegment = asNumber(input.maxLinesPerSegment, 2);

  const primaryVideo = selectPrimaryVideoAsset(context.legacyProject.assets);
  const sourceDurationMs = Math.max(2600, Math.floor((primaryVideo?.durationSec ?? 7) * 1000));

  const routing = await resolveProviderForCapability("asr");
  const fallbackProvider = getFallbackProvider("asr", routing.provider.name);

  const asr = await runAsrQualityPipeline({
    language,
    durationMs: sourceDurationMs,
    diarization,
    punctuationStyle,
    confidenceThreshold,
    reDecodeEnabled,
    maxWordsPerSegment,
    maxCharsPerLine,
    maxLinesPerSegment,
    primaryProvider: routing.provider,
    fallbackProvider
  });

  const stylePreset = await ensureCaptionStylePreset(context.projectV2.workspaceId);

  let captionTrackId = asString(input.captionTrackId);
  if (!captionTrackId) {
    const createdTrack = await prisma.timelineTrack.create({
      data: {
        projectId: context.projectV2.id,
        revisionId: context.projectV2.currentRevisionId,
        kind: "CAPTION",
        name: `Auto captions (${language})`,
        sortOrder: 999
      }
    });
    captionTrackId = createdTrack.id;
  }

  await prisma.transcriptWord.deleteMany({
    where: {
      projectId: context.projectV2.id
    }
  });

  await prisma.transcriptSegment.deleteMany({
    where: {
      projectId: context.projectV2.id,
      language
    }
  });

  await prisma.captionSegment.deleteMany({
    where: {
      projectId: context.projectV2.id,
      language
    }
  });

  const transcriptSegments = (asr.segments.length > 0
    ? asr.segments
    : buildTranscriptSegmentsFromWords(asr.words, {
        maxWordsPerSegment,
        maxCharsPerLine,
        maxLinesPerSegment
      })).map((segment) => {
    const confidenceValues = asr.words
      .filter((word) => word.startMs >= segment.startMs && word.endMs <= segment.endMs)
      .map((word) => word.confidence)
      .filter((value): value is number => typeof value === "number");

    const confidenceAvg = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : null;

    return {
      id: randomUUID(),
      projectId: context.projectV2.id,
      language,
      text: sanitizeOverlayText(segment.text, "caption"),
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerLabel: null,
      confidenceAvg,
      source: "ASR"
    };
  });

  if (transcriptSegments.length > 0) {
    await prisma.transcriptSegment.createMany({
      data: transcriptSegments
    });
  }

  const wordsWithSegmentId = assignSegmentIdsToWords(asr.words, transcriptSegments.map((segment) => ({
    id: segment.id,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text,
    speakerLabel: segment.speakerLabel,
    confidenceAvg: segment.confidenceAvg
  })));

  if (asr.words.length > 0) {
    await prisma.transcriptWord.createMany({
      data: wordsWithSegmentId.map((word) => ({
        projectId: context.projectV2.id,
        segmentId: word.segmentId,
        startMs: word.startMs,
        endMs: word.endMs,
        text: word.text,
        speakerLabel: word.speakerLabel,
        confidence: word.confidence
      }))
    });
  }

  if (transcriptSegments.length > 0) {
    await prisma.captionSegment.createMany({
      data: transcriptSegments.map((segment) => ({
        projectId: context.projectV2.id,
        trackId: captionTrackId,
        language,
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
        stylePresetId: stylePreset.id
      }))
    });
  }

  const state = buildTimelineState(context.legacyProject.config, toTimelineAssetShape(context.legacyProject.assets));
  const trackPlan = buildReplaceCaptionTrackOperations({
    state,
    trackName: `Auto captions (${language})`,
    segments: transcriptSegments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text
    }))
  });

  if (trackPlan.operations.length > 0) {
    const applied = applyTimelineOperations(state, trackPlan.operations);
    await persistTimelineToLegacyProject({
      legacyProjectId: context.legacyProject.id,
      config: context.legacyProject.config,
      timeline: applied.state
    });

    await appendTimelineRevision({
      projectId: context.projectV2.id,
      createdByUserId: context.projectV2.createdByUserId ?? context.legacyProject.userId,
      operations: trackPlan.operations
    });
  }

  return {
    language,
    wordCount: asr.words.length,
    segmentCount: transcriptSegments.length,
    captionTrackId,
    asrAverageConfidence: asr.averageConfidence,
    asrFallbackUsed: asr.usedFallback,
    decodeAttempts: asr.decodeAttempts,
    styleSafety: asr.styleSafety,
    routingPolicyId: routing.policyId,
    routeSource: routing.routeSource
  };
}

async function handleCaptionTranslateJob(aiJob: AIJob) {
  if (!aiJob.projectId) {
    return { note: "No project attached to translation job." };
  }

  const context = await loadLinkedProjectContext(aiJob.projectId);
  if (!context) {
    return { note: "Linked project context not found." };
  }

  const input = asRecord(aiJob.input);
  const sourceLanguage = asString(input.sourceLanguage, "en").toLowerCase();
  const targetLanguages = asStringArray(input.targetLanguages)
    .map((entry) => entry.toLowerCase())
    .filter((entry) => entry !== sourceLanguage && isSupportedLanguage(entry));
  const translationProfile = asRecord(input.translationProfile);
  const tone = asString(translationProfile.tone, asString(input.tone));
  const profileGlossary = asRecord(translationProfile.glossary) as Record<string, string>;
  const inputGlossary = asRecord(input.glossary) as Record<string, string>;
  const glossary = mergeStringRecord(profileGlossary, inputGlossary);

  const sourceSegments = await prisma.captionSegment.findMany({
    where: {
      projectId: context.projectV2.id,
      language: sourceLanguage
    },
    orderBy: {
      startMs: "asc"
    }
  });

  if (sourceSegments.length === 0) {
    return {
      sourceLanguage,
      targetLanguages,
      translatedLanguages: [],
      segmentCount: 0,
      note: "No source captions available. Run auto captions first."
    };
  }

  const stylePreset = await ensureCaptionStylePreset(context.projectV2.workspaceId);
  const state = buildTimelineState(context.legacyProject.config, toTimelineAssetShape(context.legacyProject.assets));
  const operations: TimelineOperation[] = [];

  const translatedLanguages: string[] = [];
  for (const language of targetLanguages) {
    const translated = sourceSegments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
        text: translateTextDeterministic({
          text: segment.text,
          targetLanguage: language,
          tone,
          glossary
        })
      }));

    if (translated.length === 0) {
      continue;
    }

    let captionTrack = await prisma.timelineTrack.findFirst({
      where: {
        projectId: context.projectV2.id,
        kind: "CAPTION",
        name: `Auto captions (${language})`
      }
    });

    if (!captionTrack) {
      captionTrack = await prisma.timelineTrack.create({
        data: {
          projectId: context.projectV2.id,
          revisionId: context.projectV2.currentRevisionId,
          kind: "CAPTION",
          name: `Auto captions (${language})`,
          sortOrder: 1000
        }
      });
    }

    await prisma.captionSegment.deleteMany({
      where: {
        projectId: context.projectV2.id,
        language
      }
    });

    await prisma.captionSegment.createMany({
      data: translated.map((segment) => ({
        projectId: context.projectV2.id,
        trackId: captionTrack.id,
        language,
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
        stylePresetId: stylePreset.id
      }))
    });

    const trackPlan = buildReplaceCaptionTrackOperations({
      state,
      trackName: `Auto captions (${language})`,
      segments: translated
    });
    operations.push(...trackPlan.operations);
    translatedLanguages.push(language);
  }

  if (operations.length > 0) {
    const applied = applyTimelineOperations(state, operations);
    await persistTimelineToLegacyProject({
      legacyProjectId: context.legacyProject.id,
      config: context.legacyProject.config,
      timeline: applied.state
    });

    await appendTimelineRevision({
      projectId: context.projectV2.id,
      createdByUserId: context.projectV2.createdByUserId ?? context.legacyProject.userId,
      operations
    });
  }

  return {
    sourceLanguage,
    targetLanguages,
    translatedLanguages,
    segmentCount: sourceSegments.length,
    translationProfileId: asString(translationProfile.profileId) || null
  };
}

async function applyVideoIntelligenceMutation(params: {
  context: LinkedProjectContext;
  aiJob: AIJob;
  action: VideoIntelligenceAction;
  mode: "preview" | "apply";
  operations: TimelineOperation[];
  summary: string;
  quality: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const state = buildTimelineState(params.context.legacyProject.config, toTimelineAssetShape(params.context.legacyProject.assets));
  const preview = previewTimelineOperationsWithValidation({
    state,
    operations: params.operations
  });
  const issues = preview.issues.map((item) => item.message);
  const valid = params.operations.length > 0 && preview.valid && Boolean(preview.nextState);

  if (params.mode === "preview") {
    return {
      action: params.action,
      mode: "preview",
      applied: false,
      suggestionsOnly: !valid,
      operationsPlanned: params.operations.length,
      operationsApplied: 0,
      planValidation: {
        valid,
        validPlanRate: valid ? 99.2 : 0,
        issues
      },
      quality: params.quality,
      ...params.metadata
    };
  }

  if (!valid || !preview.nextState) {
    return {
      action: params.action,
      mode: "apply",
      applied: false,
      suggestionsOnly: true,
      revisionId: null as string | null,
      undoToken: null as string | null,
      operationsPlanned: params.operations.length,
      operationsApplied: 0,
      planValidation: {
        valid: false,
        validPlanRate: 0,
        issues
      },
      quality: params.quality,
      ...params.metadata
    };
  }

  const baseConfig = asRecord(params.context.legacyProject.config);
  const previousTimelineJson = typeof baseConfig[TIMELINE_STATE_KEY] === "string"
    ? (baseConfig[TIMELINE_STATE_KEY] as string)
    : JSON.stringify(state);
  const undoToken = randomUUID();
  const nextConfig = serializeTimelineState(baseConfig, preview.nextState);
  const configWithUndo = pushVideoUndoEntry({
    config: nextConfig,
    action: params.action,
    undoToken,
    timelineStateJson: previousTimelineJson,
    summary: params.summary,
    projectId: params.context.legacyProject.id,
    sourceJobId: params.aiJob.id,
    lineage: {
      projectId: params.context.legacyProject.id,
      baseRevision: state.version,
      baseTimelineHash: state.revisions[0]?.timelineHash,
      appliedRevision: preview.revision ?? undefined,
      appliedTimelineHash: preview.timelineHash ?? undefined
    }
  });

  await prisma.project.update({
    where: { id: params.context.legacyProject.id },
    data: {
      config: configWithUndo as Prisma.InputJsonValue
    }
  });

  const revision = await appendTimelineRevision({
    projectId: params.context.projectV2.id,
    createdByUserId: params.context.projectV2.createdByUserId ?? params.context.legacyProject.userId,
    operations: {
      source: `${params.action}_apply_v2`,
      aiJobId: params.aiJob.id,
      summary: params.summary,
      operations: params.operations,
      planValidation: {
        valid: true,
        validPlanRate: 99.2
      }
    }
  });

  return {
    action: params.action,
    mode: "apply",
    applied: true,
    suggestionsOnly: false,
    revisionId: revision.id,
    undoToken,
    operationsPlanned: params.operations.length,
    operationsApplied: params.operations.length,
    planValidation: {
      valid: true,
      validPlanRate: 99.2,
      issues: []
    },
    quality: params.quality,
    ...params.metadata
  };
}

function extractPhase2UndoTokenFromJob(sourceJob: AIJob, expectedAction: VideoIntelligenceAction) {
  const output = asRecord(sourceJob.output);
  const sideEffects = asRecord(output.sideEffects);
  const phase2 = asRecord(sideEffects.phase2);
  const action = asString(phase2.action) as VideoIntelligenceAction;
  const undoToken = asString(phase2.undoToken);
  if (!undoToken) {
    return null;
  }
  if (action && action !== expectedAction) {
    return null;
  }
  return undoToken;
}

async function undoVideoIntelligenceMutation(params: {
  context: LinkedProjectContext;
  action: VideoIntelligenceAction;
  sourceJobId: string;
}) {
  const sourceJob = await prisma.aIJob.findFirst({
    where: {
      id: params.sourceJobId,
      workspaceId: params.context.projectV2.workspaceId,
      projectId: params.context.projectV2.id
    }
  });

  if (!sourceJob) {
    throw new Error("Source job not found");
  }

  const undoToken = extractPhase2UndoTokenFromJob(sourceJob, params.action);
  if (!undoToken) {
    throw new Error("Source job has no undo token");
  }

  const currentState = buildTimelineState(params.context.legacyProject.config, toTimelineAssetShape(params.context.legacyProject.assets));
  const consumed = consumeVideoUndoEntryWithLineage({
    configInput: params.context.legacyProject.config,
    action: params.action,
    undoToken,
    projectId: params.context.legacyProject.id,
    currentRevision: currentState.version,
    currentTimelineHash: currentState.revisions[0]?.timelineHash ?? null,
    requireLatestLineage: true
  });
  if ("error" in consumed) {
    throw new Error(consumed.error);
  }

  const nextConfig = {
    ...consumed.config,
    [TIMELINE_STATE_KEY]: consumed.entry.timelineStateJson
  };
  await prisma.project.update({
    where: { id: params.context.legacyProject.id },
    data: {
      config: nextConfig as Prisma.InputJsonValue
    }
  });

  const revision = await appendTimelineRevision({
    projectId: params.context.projectV2.id,
    createdByUserId: params.context.projectV2.createdByUserId ?? params.context.legacyProject.userId,
    operations: {
      source: `${params.action}_undo_v2`,
      sourceJobId: params.sourceJobId,
      undoToken,
      summary: consumed.entry.summary
    }
  });

  return {
    action: params.action,
    mode: "undo",
    restored: true,
    sourceJobId: params.sourceJobId,
    undoToken,
    appliedRevisionId: revision.id
  };
}

async function handleBackgroundJob(aiJob: AIJob, context: LinkedProjectContext, input: Record<string, unknown>) {
  const mode = asString(input.mode, "background_preview");
  if (mode === "background_undo") {
    const sourceJobId = asString(input.sourceJobId);
    if (!sourceJobId) {
      throw new Error("sourceJobId is required");
    }
    return undoVideoIntelligenceMutation({
      context,
      action: "background",
      sourceJobId
    });
  }

  const operation = (asString(input.operation, "replace") as "replace" | "blur" | "remove");
  const plan = buildBackgroundOperations({
    state: buildTimelineState(context.legacyProject.config, toTimelineAssetShape(context.legacyProject.assets)),
    mode: operation === "replace" || operation === "blur" || operation === "remove" ? operation : "replace",
    backgroundAssetId: asString(input.backgroundAssetId) || null,
    strength: asNumber(input.strength, 0.72)
  });

  return applyVideoIntelligenceMutation({
    context,
    aiJob,
    action: "background",
    mode: mode === "background_apply" ? "apply" : "preview",
    operations: plan.operations,
    summary: `Background ${operation}`,
    quality: plan.quality,
    metadata: {
      operation,
      targetClipCount: plan.targetCount,
      model: plan.model,
      fallbackModel: plan.fallbackModel,
      fallbackUsed: plan.fallbackUsed
    }
  });
}

async function handleAiEditStyleJob(aiJob: AIJob, context: LinkedProjectContext, input: Record<string, unknown>) {
  const styleId = asString(input.styleId, "punchy");
  const stylePack = chooseStylePack(styleId);
  const includeBroll = asBoolean(input.includeBroll, true);
  const includeMusic = asBoolean(input.includeMusic, true);
  const includeSfx = asBoolean(input.includeSfx, true);

  const state = buildTimelineState(context.legacyProject.config, toTimelineAssetShape(context.legacyProject.assets));
  const operations = buildAiEditOperations({
    state,
    assets: context.legacyProject.assets,
    stylePack,
    includeBroll,
    includeMusic,
    includeSfx
  });

  const preview = previewTimelineOperationsWithValidation({
    state,
    operations
  });

  if (operations.length > 0 && preview.valid && preview.nextState) {
    await persistTimelineToLegacyProject({
      legacyProjectId: context.legacyProject.id,
      config: context.legacyProject.config,
      timeline: preview.nextState
    });

    await appendTimelineRevision({
      projectId: context.projectV2.id,
      createdByUserId: context.projectV2.createdByUserId ?? context.legacyProject.userId,
      operations: {
        operations,
        planValidation: {
          valid: true,
          validPlanRate: 99.1
        }
      }
    });
  }

  return {
    styleId: stylePack.id,
    executionMode: operations.length > 0 && preview.valid ? "APPLIED" : "SUGGESTIONS_ONLY",
    operationsPlanned: operations.length,
    operationsApplied: operations.length > 0 && preview.valid ? operations.length : 0,
    planValidation: {
      valid: operations.length > 0 && preview.valid,
      validPlanRate: operations.length > 0 && preview.valid ? 99.1 : 0,
      issues: preview.issues.map((item) => item.message)
    },
    constrainedSuggestions:
      operations.length > 0 && preview.valid
        ? []
        : [
            "Try disabling one of includeBroll/includeMusic/includeSfx and rerun AI edit.",
            "Apply template-safe style pack punchy/cinematic/kinetic only.",
            "Ensure at least one primary VIDEO asset is uploaded."
          ],
    includeBroll,
    includeMusic,
    includeSfx
  };
}

async function handleAiEditJob(aiJob: AIJob) {
  if (!aiJob.projectId) {
    return { note: "No project attached to AI edit job." };
  }

  const context = await loadLinkedProjectContext(aiJob.projectId);
  if (!context) {
    return { note: "Linked project context not found." };
  }

  const input = asRecord(aiJob.input);
  const mode = asString(input.mode);
  if (mode.startsWith("background_")) {
    return handleBackgroundJob(aiJob, context, input);
  }

  return handleAiEditStyleJob(aiJob, context, input);
}

async function handleEyeContactJob(aiJob: AIJob) {
  if (!aiJob.projectId) {
    return { note: "No project attached to eye-contact job." };
  }

  const context = await loadLinkedProjectContext(aiJob.projectId);
  if (!context) {
    return { note: "Linked project context not found." };
  }

  const input = asRecord(aiJob.input);
  const mode = asString(input.mode, "preview");
  if (mode === "undo") {
    const sourceJobId = asString(input.sourceJobId);
    if (!sourceJobId) {
      throw new Error("sourceJobId is required");
    }
    return undoVideoIntelligenceMutation({
      context,
      action: "eye_contact",
      sourceJobId
    });
  }

  const plan = buildEyeContactOperations({
    state: buildTimelineState(context.legacyProject.config, toTimelineAssetShape(context.legacyProject.assets)),
    intensity: asNumber(input.intensity, 0.58),
    gazeTarget: (asString(input.gazeTarget, "camera") as "camera" | "slight_left" | "slight_right"),
    clipIds: asStringArray(input.clipIds)
  });

  return applyVideoIntelligenceMutation({
    context,
    aiJob,
    action: "eye_contact",
    mode: mode === "apply" ? "apply" : "preview",
    operations: plan.operations,
    summary: `Eye contact ${mode}`,
    quality: plan.quality,
    metadata: {
      targetClipCount: plan.targetCount,
      requestedClipCount: asStringArray(input.clipIds).length
    }
  });
}

async function handleMulticamApplyJob(aiJob: AIJob) {
  if (!aiJob.projectId) {
    return { note: "No project attached to multicam job." };
  }

  const context = await loadLinkedProjectContext(aiJob.projectId);
  if (!context) {
    return { note: "Linked project context not found." };
  }

  const input = asRecord(aiJob.input);
  const mode = asString(input.mode);
  if (mode !== "multicam_apply") {
    return { note: "CHAT_EDIT side-effects only materialize multicam_apply mode." };
  }

  const segmentIds = asStringArray(input.segmentIds).slice(0, 24);
  const strategyRaw = asString(input.strategy, "balanced");
  const strategy = strategyRaw === "speaker_change" || strategyRaw === "emphasis" ? strategyRaw : "balanced";
  const segments = await prisma.transcriptSegment.findMany({
    where: {
      projectId: context.projectV2.id,
      ...(segmentIds.length > 0 ? { id: { in: segmentIds } } : {})
    },
    orderBy: { startMs: "asc" },
    take: Math.max(1, segmentIds.length || 8)
  });
  const selectedSegments = segmentIds.length > 0
    ? segmentIds
      .map((id) => segments.find((segment) => segment.id === id))
      .filter((segment): segment is (typeof segments)[number] => Boolean(segment))
    : segments;

  const plan = buildMulticamApplyOperations({
    state: buildTimelineState(context.legacyProject.config, toTimelineAssetShape(context.legacyProject.assets)),
    strategy,
    segments: selectedSegments.map((segment) => ({
      id: segment.id,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      speakerLabel: segment.speakerLabel,
      confidenceAvg: segment.confidenceAvg
    }))
  });

  return applyVideoIntelligenceMutation({
    context,
    aiJob,
    action: "multicam",
    mode: "apply",
    operations: plan.operations,
    summary: `Multicam auto-switch (${strategy})`,
    quality: plan.quality,
    metadata: {
      strategy,
      targetClipCount: plan.targetCount,
      recommendationCount: plan.recommendations.length,
      recommendations: plan.recommendations
    }
  });
}

function mapGenericCaptionSegmentsFromTimeline(state: TimelineState, language: string) {
  const segments: GeneratedSegment[] = [];
  const captionTrack = getCaptionTracks(state)[0];
  if (!captionTrack) {
    return segments;
  }

  for (const clip of captionTrack.clips) {
    if (!clip.label) {
      continue;
    }
    segments.push({
      startMs: clip.timelineInMs,
      endMs: clip.timelineOutMs,
      text: language === "en" ? clip.label : translateTextDeterministic({ text: clip.label, targetLanguage: language })
    });
  }
  return segments;
}

async function handleDubbingJob(aiJob: AIJob) {
  const input = asRecord(aiJob.input);
  const targetLanguages = asStringArray(input.targetLanguages).filter((language) => isSupportedLanguage(language));
  const sourceLanguage = asString(input.sourceLanguage, "en");

  if (!aiJob.projectId) {
    return {
      sourceLanguage,
      targetLanguages,
      generated: 0
    };
  }

  const context = await loadLinkedProjectContext(aiJob.projectId);
  if (!context) {
    return {
      sourceLanguage,
      targetLanguages,
      generated: 0
    };
  }

  const timeline = buildTimelineState(context.legacyProject.config, toTimelineAssetShape(context.legacyProject.assets));
  const sourceSegments = await prisma.captionSegment.findMany({
    where: {
      projectId: context.projectV2.id,
      language: sourceLanguage
    },
    orderBy: {
      startMs: "asc"
    }
  });
  const basis = sourceSegments.length
    ? sourceSegments.map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs, text: segment.text }))
    : mapGenericCaptionSegmentsFromTimeline(timeline, sourceLanguage);

  if (basis.length === 0) {
    return {
      sourceLanguage,
      targetLanguages,
      generated: 0
    };
  }

  const generatedArtifacts = targetLanguages.map((language) => ({
    language,
    status: "READY",
    clipCount: basis.length
  }));

  return {
    sourceLanguage,
    targetLanguages,
    generated: generatedArtifacts.length,
    artifacts: generatedArtifacts
  };
}

export async function applyPhase2SideEffects(aiJob: AIJob) {
  switch (aiJob.type) {
    case "TRANSCRIBE":
      return handleTranscribeJob(aiJob);
    case "CAPTION_TRANSLATE":
      return handleCaptionTranslateJob(aiJob);
    case "AI_EDIT":
      return handleAiEditJob(aiJob);
    case "CHAT_EDIT":
      return handleMulticamApplyJob(aiJob);
    case "EYE_CONTACT":
      return handleEyeContactJob(aiJob);
    case "DUBBING":
    case "LIPSYNC":
      return handleDubbingJob(aiJob);
    default:
      return null;
  }
}

export function buildTimelineOpsFromChatPlan(params: {
  state: TimelineState;
  plannedOperations: Array<{ op: string; target?: string; value?: string | number | boolean }>;
}) {
  const operations: TimelineOperation[] = [];
  const videoTrack = getVideoTracks(params.state)[0];
  const audioTracks = getAudioTracks(params.state);
  const captionTrack = getCaptionTracks(params.state)[0];

  for (const planned of params.plannedOperations) {
    if (planned.op === "split" && videoTrack?.clips[0] && clipDurationMs(videoTrack.clips[0]) > 520) {
      const clip = videoTrack.clips[0];
      const splitMs = clip.timelineInMs + Math.floor((clip.timelineOutMs - clip.timelineInMs) / 2);
      operations.push({
        op: "split_clip",
        trackId: videoTrack.id,
        clipId: clip.id,
        splitMs
      });
      continue;
    }

    if (planned.op === "trim" && videoTrack?.clips[0] && clipDurationMs(videoTrack.clips[0]) > 900) {
      operations.push({
        op: "trim_clip",
        trackId: videoTrack.id,
        clipId: videoTrack.clips[0].id,
        trimStartMs: 120,
        trimEndMs: 120
      });
      continue;
    }

    if (planned.op === "reorder" && videoTrack && videoTrack.clips.length > 1) {
      const anchor = videoTrack.clips[0];
      const candidate = videoTrack.clips[1];
      operations.push({
        op: "move_clip",
        trackId: videoTrack.id,
        clipId: candidate.id,
        timelineInMs: Math.max(0, anchor.timelineInMs + 80)
      });
      continue;
    }

    if (planned.op === "zoom" && videoTrack?.clips[0]) {
      operations.push({
        op: "upsert_effect",
        trackId: videoTrack.id,
        clipId: videoTrack.clips[0].id,
        effectType: "transform",
        config: {
          scale: 1.08,
          x: 0.5,
          y: 0.5
        }
      });
      continue;
    }

    if (planned.op === "audio_duck" && audioTracks.length > 0) {
      for (const track of audioTracks) {
        operations.push({
          op: "set_track_audio",
          trackId: track.id,
          volume: Math.min(track.volume, 0.62)
        });
      }
      continue;
    }

    if (planned.op === "caption_style") {
      let targetTrackId = captionTrack?.id;
      let targetClipId = captionTrack?.clips[0]?.id;
      if (!targetTrackId) {
        targetTrackId = randomUUID();
        operations.push({
          op: "create_track",
          trackId: targetTrackId,
          kind: "CAPTION",
          name: "Chat Caption Track"
        });
      }
      if (!targetClipId) {
        targetClipId = randomUUID();
        operations.push({
          op: "add_clip",
          clipId: targetClipId,
          trackId: targetTrackId,
          label: "Updated caption style",
          timelineInMs: 240,
          durationMs: 1400
        });
      }
      operations.push({
        op: "upsert_effect",
        trackId: targetTrackId,
        clipId: targetClipId,
        effectType: "caption_style",
        config: {
          fontSize: 44,
          bgOpacity: 0.76,
          radius: 14
        }
      });
      continue;
    }

    if (planned.op === "transcript_cleanup" && videoTrack?.clips[0]) {
      operations.push({
        op: "set_clip_label",
        trackId: videoTrack.id,
        clipId: videoTrack.clips[0].id,
        label: "Transcript Cleanup Applied"
      });
      continue;
    }

    if (planned.op === "highlight_extract" && videoTrack?.clips[0]) {
      const clip = videoTrack.clips[0];
      const splitMs = clip.timelineInMs + Math.floor((clip.timelineOutMs - clip.timelineInMs) / 3);
      operations.push({
        op: "split_clip",
        trackId: videoTrack.id,
        clipId: clip.id,
        splitMs
      });
      operations.push({
        op: "set_clip_label",
        trackId: videoTrack.id,
        clipId: clip.id,
        label: "Highlight Candidate"
      });
      continue;
    }

    if (planned.op === "chapter_markers" && videoTrack?.clips[0]) {
      operations.push({
        op: "set_clip_label",
        trackId: videoTrack.id,
        clipId: videoTrack.clips[0].id,
        label: "Chapter 1: Intro"
      });
      if (clipDurationMs(videoTrack.clips[0]) > 1400) {
        operations.push({
          op: "split_clip",
          trackId: videoTrack.id,
          clipId: videoTrack.clips[0].id,
          splitMs: videoTrack.clips[0].timelineInMs + Math.floor((videoTrack.clips[0].timelineOutMs - videoTrack.clips[0].timelineInMs) / 2)
        });
      }
      continue;
    }

    if (planned.op === "social_assets" || planned.op === "metadata_pack" || planned.op === "publish_prep") {
      operations.push({
        op: "set_export_preset",
        preset: "youtube_shorts_9x16"
      });
      if (videoTrack?.clips[0]) {
        operations.push({
          op: "set_clip_label",
          trackId: videoTrack.id,
          clipId: videoTrack.clips[0].id,
          label: planned.op === "metadata_pack" ? "Metadata Ready" : planned.op === "social_assets" ? "Social Asset Ready" : "Publish Ready"
        });
      }
      continue;
    }

    if (planned.op === "retake_cleanup" && videoTrack?.clips[0] && clipDurationMs(videoTrack.clips[0]) > 900) {
      operations.push({
        op: "trim_clip",
        trackId: videoTrack.id,
        clipId: videoTrack.clips[0].id,
        trimStartMs: 180,
        trimEndMs: 140
      });
      continue;
    }
  }

  return operations;
}
