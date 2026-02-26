import { randomUUID } from "crypto";
import type { AudioEnhancementPreset, FillerCandidateStatus, Prisma, TranscriptSegment, TranscriptWord } from "@prisma/client";
import { requireProjectContext } from "@/lib/api-context";
import { appendTimelineRevision } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { sanitizeOverlayText } from "@/lib/sanitize";
import { patchTranscript } from "@/lib/transcript/service";
import { previewTimelineOperationsWithValidation } from "@/lib/timeline-invariants";
import { TIMELINE_STATE_KEY, buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";
import type { TimelineOperation, TimelineState } from "@/lib/timeline-types";

const AUDIO_UNDO_STACK_KEY = "audioEnhanceUndoStack";
const AUDIO_UNDO_STACK_LIMIT = 15;

const FILLER_TOKENS = new Set([
  "um",
  "uh",
  "erm",
  "ah",
  "like",
  "basically",
  "actually",
  "literally",
  "right",
  "okay"
]);

const FILLER_BIGRAMS = new Set(["you know", "kind of", "sort of", "i mean"]);

type AudioUndoLineage = {
  projectId?: string;
  baseRevision?: number;
  baseTimelineHash?: string;
  appliedRevision?: number;
  appliedTimelineHash?: string;
};

type AudioUndoEntry = {
  token: string;
  timelineStateJson: string;
  createdAt: string;
  summary: string;
  projectId?: string;
  lineage?: AudioUndoLineage;
};

export type AudioEnhancementPresetInput =
  | "clean_voice"
  | "dialogue_enhance"
  | "broadcast_loudness"
  | "custom";

export type AudioEnhancementInput = {
  language: string;
  preset: AudioEnhancementPresetInput;
  denoise?: boolean;
  clarity?: boolean;
  deEsser?: boolean;
  normalizeLoudness?: boolean;
  bypassEnhancement?: boolean;
  soloPreview?: boolean;
  confirmed?: boolean;
  targetLufs: number;
  intensity: number;
};

export type AudioFillerInput = {
  language: string;
  candidateIds?: string[];
  maxCandidates: number;
  maxConfidence: number;
  confirmed?: boolean;
  minConfidenceForRipple: number;
};

export type AudioIssue = {
  code: string;
  message: string;
  severity: "INFO" | "WARN" | "ERROR";
};

export type AudioSafetyMode = "AUTO_APPLY" | "APPLY_WITH_CONFIRM" | "PREVIEW_ONLY";

export type AudioSafetyRationale = {
  confidenceScore: number;
  reasons: string[];
};

export type DetectedFillerCandidate = {
  id: string;
  segmentId: string | null;
  wordId: string | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  reason: "TOKEN" | "BIGRAM";
  wordIds: string[];
};

type AudioEnhancementProfile = {
  preset: AudioEnhancementPresetInput;
  denoise: boolean;
  clarity: boolean;
  deEsser: boolean;
  normalizeLoudness: boolean;
  bypassEnhancement: boolean;
  soloPreview: boolean;
  targetLufs: number;
  intensity: number;
  trackVolumeScale: number;
  compressionRatio: number;
  eqPresence: number;
  denoiseStrength: number;
  deEsserStrength: number;
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeWord(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function toPresetEnum(input: AudioEnhancementPresetInput): AudioEnhancementPreset {
  if (input === "clean_voice") return "CLEAN_VOICE";
  if (input === "broadcast_loudness") return "BROADCAST_LOUDNESS";
  if (input === "custom") return "CUSTOM";
  return "DIALOGUE_ENHANCE";
}

function parseUndoStack(config: Record<string, unknown>) {
  const raw = config[AUDIO_UNDO_STACK_KEY];
  if (!Array.isArray(raw)) {
    return [] as AudioUndoEntry[];
  }
  const parsed: AudioUndoEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Record<string, unknown>;
    const token = typeof candidate.token === "string" ? candidate.token : "";
    const timelineStateJson = typeof candidate.timelineStateJson === "string" ? candidate.timelineStateJson : "";
    if (!token || !timelineStateJson) {
      continue;
    }
    const lineageRaw = (candidate.lineage ?? {}) as Record<string, unknown>;
    parsed.push({
      token,
      timelineStateJson,
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
      summary: typeof candidate.summary === "string" ? candidate.summary : "audio enhancement",
      projectId: typeof candidate.projectId === "string" ? candidate.projectId : undefined,
      lineage: {
        projectId: typeof lineageRaw.projectId === "string" ? lineageRaw.projectId : undefined,
        baseRevision: typeof lineageRaw.baseRevision === "number" ? Math.trunc(lineageRaw.baseRevision) : undefined,
        baseTimelineHash: typeof lineageRaw.baseTimelineHash === "string" ? lineageRaw.baseTimelineHash : undefined,
        appliedRevision: typeof lineageRaw.appliedRevision === "number" ? Math.trunc(lineageRaw.appliedRevision) : undefined,
        appliedTimelineHash: typeof lineageRaw.appliedTimelineHash === "string" ? lineageRaw.appliedTimelineHash : undefined
      }
    });
  }
  return parsed;
}

function pushAudioUndoEntry(params: {
  config: Record<string, unknown>;
  undoToken: string;
  timelineStateJson: string;
  summary: string;
  projectId?: string;
  lineage?: AudioUndoLineage;
}) {
  const existing = parseUndoStack(params.config);
  const next: AudioUndoEntry[] = [
    {
      token: params.undoToken,
      timelineStateJson: params.timelineStateJson,
      createdAt: new Date().toISOString(),
      summary: sanitizeOverlayText(params.summary, "Audio enhancement"),
      projectId: params.projectId,
      lineage: params.lineage
    },
    ...existing
  ].slice(0, AUDIO_UNDO_STACK_LIMIT);
  return {
    ...params.config,
    [AUDIO_UNDO_STACK_KEY]: next
  };
}

function consumeAudioUndoEntry(params: {
  configInput: unknown;
  undoToken: string;
  projectId?: string;
  currentRevision?: number;
  currentTimelineHash?: string | null;
  requireLatestLineage?: boolean;
}): { entry: AudioUndoEntry; config: Record<string, unknown> } | { error: string } {
  const config = (params.configInput && typeof params.configInput === "object"
    ? (params.configInput as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const stack = parseUndoStack(config);
  const index = stack.findIndex((entry) => entry.token === params.undoToken);
  if (index < 0) {
    return { error: "Undo token not found" };
  }
  const entry = stack[index];
  if (!entry) {
    return { error: "Undo token not found" };
  }
  if (params.projectId && entry.projectId && params.projectId !== entry.projectId) {
    return { error: "Undo token does not belong to this project" };
  }
  if (params.requireLatestLineage) {
    if (!entry.lineage?.appliedRevision || !entry.lineage.appliedTimelineHash) {
      return { error: "Undo token missing lineage metadata" };
    }
    if (typeof params.currentRevision === "number" && params.currentRevision !== entry.lineage.appliedRevision) {
      return { error: "Undo token no longer matches current timeline revision" };
    }
    if (params.currentTimelineHash && params.currentTimelineHash !== entry.lineage.appliedTimelineHash) {
      return { error: "Undo token no longer matches current timeline hash" };
    }
  }
  const remaining = [...stack.slice(0, index), ...stack.slice(index + 1)];
  return {
    entry,
    config: {
      ...config,
      [AUDIO_UNDO_STACK_KEY]: remaining
    }
  };
}

function estimateTimelineDurationMs(state: TimelineState, assets: Array<{ durationSec: number | null }>) {
  const timelineMax = state.tracks.reduce((maxTrack, track) => {
    const maxClip = track.clips.reduce((maxClipMs, clip) => Math.max(maxClipMs, clip.timelineOutMs), 0);
    return Math.max(maxTrack, maxClip);
  }, 0);
  const assetMax = assets.reduce((maxAsset, asset) => Math.max(maxAsset, Math.floor((asset.durationSec ?? 0) * 1000)), 0);
  return Math.max(1000, timelineMax, assetMax);
}

function buildAudioProfile(input: AudioEnhancementInput): AudioEnhancementProfile {
  const preset = input.preset;
  const intensity = clamp(input.intensity, 0.2, 1.6);
  const deEsser = input.deEsser ?? true;
  const bypassEnhancement = input.bypassEnhancement ?? false;
  const soloPreview = input.soloPreview ?? false;
  if (preset === "clean_voice") {
    return {
      preset,
      denoise: input.denoise ?? true,
      clarity: input.clarity ?? true,
      deEsser,
      normalizeLoudness: input.normalizeLoudness ?? true,
      bypassEnhancement,
      soloPreview,
      targetLufs: clamp(input.targetLufs, -24, -10),
      intensity,
      trackVolumeScale: clamp(0.96 + intensity * 0.04, 0.75, 1.25),
      compressionRatio: clamp(2 + intensity * 0.7, 1.5, 4.2),
      eqPresence: clamp(1.6 + intensity * 1.1, 0.5, 4.5),
      denoiseStrength: clamp(0.5 + intensity * 0.35, 0.2, 0.95),
      deEsserStrength: clamp(0.45 + intensity * 0.3, 0.1, 0.95)
    };
  }
  if (preset === "broadcast_loudness") {
    return {
      preset,
      denoise: input.denoise ?? true,
      clarity: input.clarity ?? true,
      deEsser,
      normalizeLoudness: input.normalizeLoudness ?? true,
      bypassEnhancement,
      soloPreview,
      targetLufs: clamp(input.targetLufs, -16, -10),
      intensity,
      trackVolumeScale: clamp(1 + intensity * 0.06, 0.78, 1.35),
      compressionRatio: clamp(2.6 + intensity * 0.8, 1.7, 4.5),
      eqPresence: clamp(2 + intensity * 1.2, 0.8, 5),
      denoiseStrength: clamp(0.45 + intensity * 0.3, 0.2, 0.9),
      deEsserStrength: clamp(0.4 + intensity * 0.26, 0.1, 0.9)
    };
  }
  if (preset === "custom") {
    return {
      preset,
      denoise: input.denoise ?? true,
      clarity: input.clarity ?? true,
      deEsser,
      normalizeLoudness: input.normalizeLoudness ?? true,
      bypassEnhancement,
      soloPreview,
      targetLufs: clamp(input.targetLufs, -24, -10),
      intensity,
      trackVolumeScale: clamp(1, 0.75, 1.25),
      compressionRatio: clamp(2.4, 1.5, 4.5),
      eqPresence: clamp(2.4, 0.6, 5),
      denoiseStrength: clamp(0.55, 0.2, 0.95),
      deEsserStrength: clamp(0.5, 0.1, 0.95)
    };
  }
  return {
    preset: "dialogue_enhance",
    denoise: input.denoise ?? true,
    clarity: input.clarity ?? true,
    deEsser,
    normalizeLoudness: input.normalizeLoudness ?? true,
    bypassEnhancement,
    soloPreview,
    targetLufs: clamp(input.targetLufs, -24, -10),
    intensity,
    trackVolumeScale: clamp(1 + intensity * 0.03, 0.75, 1.28),
    compressionRatio: clamp(2.3 + intensity * 0.65, 1.5, 4.3),
    eqPresence: clamp(2 + intensity * 1.05, 0.7, 4.7),
    denoiseStrength: clamp(0.42 + intensity * 0.35, 0.2, 0.95),
    deEsserStrength: clamp(0.38 + intensity * 0.3, 0.1, 0.92)
  };
}

export function buildAudioEnhancementTimelineOperations(state: TimelineState, profile: AudioEnhancementProfile) {
  const audioTracks = state.tracks.filter((track) => track.kind === "AUDIO" && track.clips.length > 0);
  const issues: AudioIssue[] = [];
  const operations: TimelineOperation[] = [];
  if (profile.bypassEnhancement) {
    issues.push({
      code: "BYPASS_ENABLED",
      message: "Bypass enhancement enabled. No timeline operations generated.",
      severity: "INFO"
    });
    return { operations, issues };
  }
  if (audioTracks.length > 0) {
    for (const track of audioTracks) {
      operations.push({
        op: "set_track_audio",
        trackId: track.id,
        volume: clamp(track.volume * profile.trackVolumeScale, 0, 1.5)
      });
      for (const clip of track.clips) {
        operations.push({
          op: "upsert_effect",
          trackId: track.id,
          clipId: clip.id,
          effectType: "audio_enhance_v1",
          config: {
            preset: profile.preset,
            denoise: profile.denoise,
            clarity: profile.clarity,
            deEsser: profile.deEsser,
            normalizeLoudness: profile.normalizeLoudness,
            targetLufs: profile.targetLufs,
            intensity: profile.intensity,
            compressionRatio: profile.compressionRatio,
            eqPresence: profile.eqPresence,
            denoiseStrength: profile.denoiseStrength,
            deEsserStrength: profile.deEsserStrength,
            soloPreview: profile.soloPreview,
            appliedAt: new Date().toISOString()
          }
        });
      }
    }
    return { operations, issues };
  }

  const videoClips = state.tracks
    .filter((track) => track.kind === "VIDEO")
    .flatMap((track) => track.clips);
  if (videoClips.length === 0) {
    issues.push({
      code: "NO_AUDIO_SOURCES",
      message: "No audio tracks or video clips found to derive audio enhancement from.",
      severity: "WARN"
    });
    return { operations, issues };
  }

  const derivedTrackId = randomUUID();
  operations.push({
    op: "create_track",
    trackId: derivedTrackId,
    kind: "AUDIO",
    name: "Derived Audio Track"
  });

  for (const clip of videoClips) {
    const clipId = randomUUID();
    const durationMs = Math.max(120, clip.timelineOutMs - clip.timelineInMs);
    operations.push({
      op: "add_clip",
      clipId,
      trackId: derivedTrackId,
      assetId: clip.assetId,
      slotKey: clip.slotKey,
      label: `Audio ${clip.label ?? "clip"}`,
      timelineInMs: clip.timelineInMs,
      durationMs,
      sourceInMs: clip.sourceInMs,
      sourceOutMs: clip.sourceOutMs
    });
    operations.push({
      op: "upsert_effect",
      trackId: derivedTrackId,
      clipId,
      effectType: "audio_enhance_v1",
      config: {
        preset: profile.preset,
        denoise: profile.denoise,
        clarity: profile.clarity,
        deEsser: profile.deEsser,
        normalizeLoudness: profile.normalizeLoudness,
        targetLufs: profile.targetLufs,
        intensity: profile.intensity,
        compressionRatio: profile.compressionRatio,
        eqPresence: profile.eqPresence,
        denoiseStrength: profile.denoiseStrength,
        deEsserStrength: profile.deEsserStrength,
        soloPreview: profile.soloPreview,
        derivedFromVideo: true,
        appliedAt: new Date().toISOString()
      }
    });
  }
  operations.push({
    op: "set_track_audio",
    trackId: derivedTrackId,
    volume: clamp(profile.trackVolumeScale, 0, 1.5)
  });
  issues.push({
    code: "AUDIO_TRACK_DERIVED",
    message: "Derived an audio track from video clips for enhancement.",
    severity: "INFO"
  });

  return { operations, issues };
}

export function detectFillerCandidates(params: {
  words: Array<Pick<TranscriptWord, "id" | "segmentId" | "text" | "startMs" | "endMs" | "confidence">>;
  segments: Array<Pick<TranscriptSegment, "id" | "startMs" | "endMs">>;
  maxCandidates: number;
  maxConfidence: number;
}) {
  const sortedWords = [...params.words].sort((a, b) => a.startMs - b.startMs);
  const candidates: DetectedFillerCandidate[] = [];
  const seen = new Set<string>();

  const resolveSegmentId = (word: Pick<TranscriptWord, "segmentId" | "startMs" | "endMs">) => {
    if (word.segmentId) {
      return word.segmentId;
    }
    const match = params.segments.find((segment) => word.startMs >= segment.startMs && word.endMs <= segment.endMs);
    return match?.id ?? null;
  };

  for (let index = 0; index < sortedWords.length; index += 1) {
    const word = sortedWords[index];
    const normalized = normalizeWord(word.text);
    if (!normalized) {
      continue;
    }
    const nextWord = sortedWords[index + 1];
    if (nextWord) {
      const phrase = `${normalized} ${normalizeWord(nextWord.text)}`.trim();
      if (FILLER_BIGRAMS.has(phrase)) {
        const key = `${word.startMs}:${nextWord.endMs}:${phrase}`;
        if (!seen.has(key)) {
          seen.add(key);
          const confidenceValues = [word.confidence, nextWord.confidence].filter((value): value is number => typeof value === "number");
          const avgConfidence = confidenceValues.length > 0
            ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
            : null;
          if (avgConfidence === null || avgConfidence <= params.maxConfidence) {
            candidates.push({
              id: `filler_${word.id}_${nextWord.id}`,
              segmentId: resolveSegmentId(word),
              wordId: word.id,
              startMs: word.startMs,
              endMs: nextWord.endMs,
              text: sanitizeOverlayText(`${word.text} ${nextWord.text}`, "filler"),
              confidence: avgConfidence,
              reason: "BIGRAM",
              wordIds: [word.id, nextWord.id]
            });
          }
        }
      }
    }

    if (!FILLER_TOKENS.has(normalized)) {
      continue;
    }
    const key = `${word.startMs}:${word.endMs}:${normalized}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (typeof word.confidence === "number" && word.confidence > params.maxConfidence) {
      continue;
    }
    candidates.push({
      id: `filler_${word.id}`,
      segmentId: resolveSegmentId(word),
      wordId: word.id,
      startMs: word.startMs,
      endMs: word.endMs,
      text: sanitizeOverlayText(word.text, "filler"),
      confidence: typeof word.confidence === "number" ? word.confidence : null,
      reason: "TOKEN",
      wordIds: [word.id]
    });
  }

  return candidates
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, params.maxCandidates);
}

function summarizeAnalysis(params: {
  state: TimelineState;
  words: Array<Pick<TranscriptWord, "confidence">>;
  fillerCandidates: DetectedFillerCandidate[];
  timelineDurationMs: number;
}) {
  const audioTracks = params.state.tracks.filter((track) => track.kind === "AUDIO");
  const audioClipCount = audioTracks.reduce((sum, track) => sum + track.clips.length, 0);
  const videoClipCount = params.state.tracks
    .filter((track) => track.kind === "VIDEO")
    .reduce((sum, track) => sum + track.clips.length, 0);
  const averageVolume = audioTracks.length > 0
    ? audioTracks.reduce((sum, track) => sum + track.volume, 0) / audioTracks.length
    : 1;
  const confidences = params.words
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === "number");
  const averageTranscriptConfidence = confidences.length > 0
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0.9;
  const estimatedNoise = clamp(1 - averageTranscriptConfidence, 0.02, 0.98);
  const estimatedLufs = -22 + averageVolume * 7;
  const recommendedPreset: AudioEnhancementPresetInput = estimatedNoise > 0.24
    ? "clean_voice"
    : estimatedLufs < -16
      ? "broadcast_loudness"
      : "dialogue_enhance";

  return {
    timelineDurationMs: params.timelineDurationMs,
    audioTrackCount: audioTracks.length,
    audioClipCount,
    transcriptWordCount: params.words.length,
    averageTrackVolume: Number(averageVolume.toFixed(3)),
    averageTranscriptConfidence: Number(averageTranscriptConfidence.toFixed(3)),
    estimatedNoiseLevel: Number(estimatedNoise.toFixed(3)),
    estimatedLoudnessLufs: Number(estimatedLufs.toFixed(2)),
    fillerCandidateCount: params.fillerCandidates.length,
    recommendedPreset,
    readyForApply: audioClipCount > 0 || videoClipCount > 0
  };
}

function predictPostEnhancementAnalysis(analysis: ReturnType<typeof summarizeAnalysis>, profile: AudioEnhancementProfile) {
  if (profile.bypassEnhancement) {
    return {
      ...analysis
    };
  }
  const noiseDelta = profile.denoise ? 0.12 * profile.intensity : 0;
  const deEsserNoiseDelta = profile.deEsser ? 0.04 * profile.intensity : 0;
  const lufsDelta = profile.normalizeLoudness ? (profile.targetLufs - analysis.estimatedLoudnessLufs) * 0.65 : 0;
  return {
    ...analysis,
    estimatedNoiseLevel: Number(clamp(analysis.estimatedNoiseLevel - noiseDelta - deEsserNoiseDelta, 0.01, 0.98).toFixed(3)),
    estimatedLoudnessLufs: Number((analysis.estimatedLoudnessLufs + lufsDelta).toFixed(2)),
    averageTrackVolume: Number(clamp(analysis.averageTrackVolume * profile.trackVolumeScale, 0, 1.5).toFixed(3))
  };
}

export function classifyEnhancementSafetyMode(params: {
  analysis: ReturnType<typeof summarizeAnalysis>;
  issues: AudioIssue[];
  profile: AudioEnhancementProfile;
}): { safetyMode: AudioSafetyMode; rationale: AudioSafetyRationale } {
  const reasons: string[] = [];
  const score = clamp(params.analysis.averageTranscriptConfidence, 0, 1);
  const hasError = params.issues.some((issue) => issue.severity === "ERROR");
  const warnCount = params.issues.filter((issue) => issue.severity === "WARN").length;

  if (params.profile.bypassEnhancement) {
    reasons.push("Bypass enhancement is enabled.");
    return {
      safetyMode: "PREVIEW_ONLY",
      rationale: { confidenceScore: score, reasons }
    };
  }

  if (hasError || !params.analysis.readyForApply || score < 0.7) {
    if (hasError) reasons.push("Invariant or timeline validation errors detected.");
    if (!params.analysis.readyForApply) reasons.push("No renderable audio/video source is available.");
    if (score < 0.7) reasons.push("Transcript confidence is too low for safe auto-apply.");
    return {
      safetyMode: "PREVIEW_ONLY",
      rationale: { confidenceScore: score, reasons }
    };
  }

  if (warnCount > 0 || params.profile.intensity > 1.25 || score < 0.84) {
    if (warnCount > 0) reasons.push("Warnings were reported while building enhancement operations.");
    if (params.profile.intensity > 1.25) reasons.push("High intensity increases risk of over-processing.");
    if (score < 0.84) reasons.push("Transcript confidence indicates moderate risk.");
    return {
      safetyMode: "APPLY_WITH_CONFIRM",
      rationale: { confidenceScore: score, reasons }
    };
  }

  reasons.push("Validation checks passed with strong confidence.");
  return {
    safetyMode: "AUTO_APPLY",
    rationale: { confidenceScore: score, reasons }
  };
}

export function classifyFillerSafetyMode(params: {
  analysis: ReturnType<typeof summarizeAnalysis>;
  candidates: DetectedFillerCandidate[];
  issues: AudioIssue[];
}): { safetyMode: AudioSafetyMode; rationale: AudioSafetyRationale } {
  const reasons: string[] = [];
  const hasError = params.issues.some((issue) => issue.severity === "ERROR");
  const confidenceValues = params.candidates
    .map((candidate) => candidate.confidence)
    .filter((value): value is number => typeof value === "number");
  const avgCandidateConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : params.analysis.averageTranscriptConfidence;
  const score = clamp(avgCandidateConfidence, 0, 1);

  if (hasError || params.candidates.length === 0 || score < 0.7) {
    if (hasError) reasons.push("Transcript patch preview reported blocking errors.");
    if (params.candidates.length === 0) reasons.push("No eligible filler candidates matched the current filter.");
    if (score < 0.7) reasons.push("Candidate confidence is too low for safe destructive apply.");
    return {
      safetyMode: "PREVIEW_ONLY",
      rationale: { confidenceScore: score, reasons }
    };
  }

  if (params.candidates.length > 25 || score < 0.86) {
    if (params.candidates.length > 25) reasons.push("Large candidate batch requires explicit confirmation.");
    if (score < 0.86) reasons.push("Candidate confidence indicates moderate risk.");
    return {
      safetyMode: "APPLY_WITH_CONFIRM",
      rationale: { confidenceScore: score, reasons }
    };
  }

  reasons.push("Candidate confidence is high and batch size is safe.");
  return {
    safetyMode: "AUTO_APPLY",
    rationale: { confidenceScore: score, reasons }
  };
}

async function loadAudioProjectContext(projectIdOrV2Id: string, language: string, maxCandidates: number, maxConfidence: number) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const [legacyProject, words, segments, latestRun] = await Promise.all([
    prisma.project.findUnique({
      where: { id: ctx.legacyProject.id },
      select: {
        id: true,
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
    }),
    prisma.transcriptWord.findMany({
      where: { projectId: ctx.projectV2.id },
      orderBy: { startMs: "asc" }
    }),
    prisma.transcriptSegment.findMany({
      where: {
        projectId: ctx.projectV2.id,
        language
      },
      orderBy: { startMs: "asc" }
    }),
    prisma.audioEnhancementRun.findFirst({
      where: { projectId: ctx.projectV2.id },
      orderBy: { createdAt: "desc" }
    })
  ]);

  if (!legacyProject) {
    throw new Error("Project not found");
  }

  const timelineState = buildTimelineState(
    legacyProject.config,
    legacyProject.assets as Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }>
  );
  const timelineDurationMs = estimateTimelineDurationMs(timelineState, legacyProject.assets);
  const fillerCandidates = detectFillerCandidates({
    words,
    segments,
    maxCandidates,
    maxConfidence
  });
  const analysis = summarizeAnalysis({
    state: timelineState,
    words,
    fillerCandidates,
    timelineDurationMs
  });

  return {
    ctx,
    legacyProject,
    timelineState,
    words,
    segments,
    analysis,
    fillerCandidates,
    latestRun
  };
}

async function storeFillerCandidates(params: {
  runId: string;
  workspaceId: string;
  projectId: string;
  language: string;
  candidates: DetectedFillerCandidate[];
  status: FillerCandidateStatus;
}) {
  if (params.candidates.length === 0) {
    return;
  }
  await prisma.fillerCandidate.createMany({
    data: params.candidates.map((candidate) => ({
      runId: params.runId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      language: params.language,
      segmentId: candidate.segmentId,
      wordId: candidate.wordId,
      text: sanitizeOverlayText(candidate.text, "filler"),
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      confidence: candidate.confidence,
      status: params.status
    }))
  });
}

export async function getAudioAnalysis(projectIdOrV2Id: string, params: { language: string; maxCandidates: number; maxConfidence: number }) {
  const context = await loadAudioProjectContext(projectIdOrV2Id, params.language, params.maxCandidates, params.maxConfidence);
  return {
    projectId: context.legacyProject.id,
    projectV2Id: context.ctx.projectV2.id,
    language: params.language,
    analysis: context.analysis,
    fillerCandidates: context.fillerCandidates,
    lastRun: context.latestRun
      ? {
          id: context.latestRun.id,
          operation: context.latestRun.operation,
          mode: context.latestRun.mode,
          status: context.latestRun.status,
          preset: context.latestRun.preset,
          createdAt: context.latestRun.createdAt
        }
      : null
  };
}

export async function previewAudioEnhancement(projectIdOrV2Id: string, input: AudioEnhancementInput) {
  const context = await loadAudioProjectContext(projectIdOrV2Id, input.language, 120, 0.94);
  const profile = buildAudioProfile(input);
  const built = buildAudioEnhancementTimelineOperations(context.timelineState, profile);
  const predicted = predictPostEnhancementAnalysis(context.analysis, profile);
  const preview = previewTimelineOperationsWithValidation({
    state: context.timelineState,
    operations: built.operations
  });
  const issues: AudioIssue[] = [
    ...built.issues,
    ...preview.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: "ERROR" as const
    }))
  ];
  const safety = classifyEnhancementSafetyMode({
    analysis: context.analysis,
    issues,
    profile
  });

  const run = await prisma.audioEnhancementRun.create({
    data: {
      workspaceId: context.ctx.workspace.id,
      projectId: context.ctx.projectV2.id,
      createdByUserId: context.ctx.user.id,
      mode: "PREVIEW",
      operation: "ENHANCE",
      preset: toPresetEnum(profile.preset),
      status: "PREVIEWED",
      config: {
        input,
        profile
      },
      summary: {
        issues,
        timelineOpCount: built.operations.length,
        analysisBefore: context.analysis,
        analysisAfter: predicted,
        safetyMode: safety.safetyMode,
        confidenceScore: safety.rationale.confidenceScore,
        safetyReasons: safety.rationale.reasons
      }
    }
  });

  return {
    mode: "PREVIEW" as const,
    runId: run.id,
    applied: false,
    suggestionsOnly: !preview.valid || safety.safetyMode === "PREVIEW_ONLY",
    revisionId: null as string | null,
    undoToken: null as string | null,
    preset: profile.preset,
    safetyMode: safety.safetyMode,
    confidenceScore: safety.rationale.confidenceScore,
    safetyReasons: safety.rationale.reasons,
    timelineOps: built.operations,
    issues,
    analysisBefore: context.analysis,
    analysisAfter: predicted
  };
}

export async function applyAudioEnhancement(projectIdOrV2Id: string, input: AudioEnhancementInput) {
  const context = await loadAudioProjectContext(projectIdOrV2Id, input.language, 120, 0.94);
  const profile = buildAudioProfile(input);
  const built = buildAudioEnhancementTimelineOperations(context.timelineState, profile);
  const predicted = predictPostEnhancementAnalysis(context.analysis, profile);
  const preview = previewTimelineOperationsWithValidation({
    state: context.timelineState,
    operations: built.operations
  });
  const issues: AudioIssue[] = [
    ...built.issues,
    ...preview.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: "ERROR" as const
    }))
  ];
  const safety = classifyEnhancementSafetyMode({
    analysis: context.analysis,
    issues,
    profile
  });

  if (safety.safetyMode === "PREVIEW_ONLY" || (safety.safetyMode === "APPLY_WITH_CONFIRM" && input.confirmed !== true)) {
    const gatedIssues: AudioIssue[] = [
      ...issues,
      {
        code: safety.safetyMode === "APPLY_WITH_CONFIRM" ? "CONFIRMATION_REQUIRED" : "PREVIEW_ONLY_SAFETY_GATE",
        message: safety.safetyMode === "APPLY_WITH_CONFIRM"
          ? "Apply-with-confirm safety mode requires confirmed=true."
          : "Safety mode requires preview-only path for this operation.",
        severity: "WARN"
      }
    ];
    const gatedRun = await prisma.audioEnhancementRun.create({
      data: {
        workspaceId: context.ctx.workspace.id,
        projectId: context.ctx.projectV2.id,
        createdByUserId: context.ctx.user.id,
        mode: "APPLY",
        operation: "ENHANCE",
        preset: toPresetEnum(profile.preset),
        status: "ERROR",
        config: {
          input,
          profile
        },
        summary: {
          issues: gatedIssues,
          timelineOpCount: built.operations.length,
          analysisBefore: context.analysis,
          analysisAfter: predicted,
          safetyMode: safety.safetyMode,
          confidenceScore: safety.rationale.confidenceScore,
          safetyReasons: safety.rationale.reasons
        }
      }
    });
    return {
      mode: "APPLY" as const,
      runId: gatedRun.id,
      applied: false,
      suggestionsOnly: true,
      revisionId: null as string | null,
      undoToken: null as string | null,
      preset: profile.preset,
      safetyMode: safety.safetyMode,
      confidenceScore: safety.rationale.confidenceScore,
      safetyReasons: safety.rationale.reasons,
      timelineOps: built.operations,
      issues: gatedIssues,
      analysisBefore: context.analysis,
      analysisAfter: predicted
    };
  }

  if (!preview.valid || !preview.nextState) {
    const failedRun = await prisma.audioEnhancementRun.create({
      data: {
        workspaceId: context.ctx.workspace.id,
        projectId: context.ctx.projectV2.id,
        createdByUserId: context.ctx.user.id,
        mode: "APPLY",
        operation: "ENHANCE",
        preset: toPresetEnum(profile.preset),
        status: "ERROR",
        config: {
          input,
          profile
        },
        summary: {
          issues,
          timelineOpCount: built.operations.length,
          analysisBefore: context.analysis,
          analysisAfter: predicted,
          safetyMode: safety.safetyMode,
          confidenceScore: safety.rationale.confidenceScore,
          safetyReasons: safety.rationale.reasons
        }
      }
    });

    return {
      mode: "APPLY" as const,
      runId: failedRun.id,
      applied: false,
      suggestionsOnly: true,
      revisionId: null as string | null,
      undoToken: null as string | null,
      preset: profile.preset,
      safetyMode: safety.safetyMode,
      confidenceScore: safety.rationale.confidenceScore,
      safetyReasons: safety.rationale.reasons,
      timelineOps: built.operations,
      issues,
      analysisBefore: context.analysis,
      analysisAfter: predicted
    };
  }

  const baseConfig = (typeof context.legacyProject.config === "object" && context.legacyProject.config !== null
    ? (context.legacyProject.config as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const previousTimelineStateJson = typeof baseConfig[TIMELINE_STATE_KEY] === "string"
    ? (baseConfig[TIMELINE_STATE_KEY] as string)
    : JSON.stringify(context.timelineState);
  const undoToken = randomUUID();
  const nextConfig = serializeTimelineState(baseConfig, preview.nextState);
  const configWithUndo = pushAudioUndoEntry({
    config: nextConfig,
    undoToken,
    timelineStateJson: previousTimelineStateJson,
    summary: `Audio enhance (${profile.preset})`,
    projectId: context.legacyProject.id,
    lineage: {
      projectId: context.legacyProject.id,
      baseRevision: context.timelineState.version,
      baseTimelineHash: context.timelineState.revisions[0]?.timelineHash,
      appliedRevision: preview.revision ?? undefined,
      appliedTimelineHash: preview.timelineHash ?? undefined
    }
  });

  await prisma.project.update({
    where: { id: context.legacyProject.id },
    data: {
      config: configWithUndo as Prisma.InputJsonValue
    }
  });

  const revision = await appendTimelineRevision({
    projectId: context.ctx.projectV2.id,
    createdByUserId: context.ctx.user.id,
    operations: {
      source: "audio_enhance_apply_v2",
      preset: profile.preset,
      timelineOps: built.operations
    }
  });

  const run = await prisma.audioEnhancementRun.create({
    data: {
      workspaceId: context.ctx.workspace.id,
      projectId: context.ctx.projectV2.id,
      createdByUserId: context.ctx.user.id,
      timelineRevisionId: revision.id,
      mode: "APPLY",
      operation: "ENHANCE",
      preset: toPresetEnum(profile.preset),
      status: "APPLIED",
      undoToken,
      config: {
        input,
        profile
      },
      summary: {
        issues,
        timelineOpCount: built.operations.length,
        analysisBefore: context.analysis,
        analysisAfter: predicted,
        safetyMode: safety.safetyMode,
        confidenceScore: safety.rationale.confidenceScore,
        safetyReasons: safety.rationale.reasons
      }
    }
  });

  return {
    mode: "APPLY" as const,
    runId: run.id,
    applied: true,
    suggestionsOnly: false,
    revisionId: revision.id,
    undoToken,
    preset: profile.preset,
    safetyMode: safety.safetyMode,
    confidenceScore: safety.rationale.confidenceScore,
    safetyReasons: safety.rationale.reasons,
    timelineOps: built.operations,
    issues,
    analysisBefore: context.analysis,
    analysisAfter: predicted
  };
}

export async function undoAudioEnhancement(projectIdOrV2Id: string, undoToken: string, force = false) {
  const context = await loadAudioProjectContext(projectIdOrV2Id, "en", 20, 0.94);
  const currentTimeline = buildTimelineState(
    context.legacyProject.config,
    context.legacyProject.assets as Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }>
  );
  const consumed = consumeAudioUndoEntry({
    configInput: context.legacyProject.config,
    undoToken,
    projectId: context.legacyProject.id,
    currentRevision: currentTimeline.version,
    currentTimelineHash: currentTimeline.revisions[0]?.timelineHash ?? null,
    requireLatestLineage: !force
  });
  if ("error" in consumed) {
    throw new Error(consumed.error);
  }

  const nextConfig = {
    ...consumed.config,
    [TIMELINE_STATE_KEY]: consumed.entry.timelineStateJson
  };
  await prisma.project.update({
    where: { id: context.legacyProject.id },
    data: {
      config: nextConfig as Prisma.InputJsonValue
    }
  });
  const revision = await appendTimelineRevision({
    projectId: context.ctx.projectV2.id,
    createdByUserId: context.ctx.user.id,
    operations: {
      source: "audio_enhance_undo_v2",
      undoToken,
      summary: consumed.entry.summary
    }
  });

  return {
    restored: true,
    appliedRevisionId: revision.id
  };
}

function filterCandidates(input: AudioFillerInput, detected: DetectedFillerCandidate[]) {
  const candidateIdSet = input.candidateIds ? new Set(input.candidateIds) : null;
  return detected
    .filter((candidate) => {
      if (candidateIdSet && !candidateIdSet.has(candidate.id)) {
        return false;
      }
      if (typeof candidate.confidence === "number" && candidate.confidence > input.maxConfidence) {
        return false;
      }
      return true;
    })
    .slice(0, input.maxCandidates);
}

export async function previewFillerRemoval(projectIdOrV2Id: string, input: AudioFillerInput) {
  const context = await loadAudioProjectContext(projectIdOrV2Id, input.language, input.maxCandidates, input.maxConfidence);
  const selectedCandidates = filterCandidates(input, context.fillerCandidates);
  const operations = selectedCandidates.map((candidate) => ({
    op: "delete_range" as const,
    startMs: candidate.startMs,
    endMs: candidate.endMs
  }));

  const transcriptResult = operations.length > 0
    ? await patchTranscript(projectIdOrV2Id, {
        language: input.language,
        operations,
        minConfidenceForRipple: input.minConfidenceForRipple,
        previewOnly: true
      })
    : {
        applied: false,
        suggestionsOnly: true,
        timelineOps: [] as Array<{ op: string; [key: string]: unknown }>,
        issues: [
          {
            code: "NO_FILLER_CANDIDATES",
            message: "No filler candidates matched the current filter.",
            severity: "INFO" as const
          }
        ],
        revisionId: null as string | null
      };
  const baseIssues = (transcriptResult.issues as Array<{ code: string; message: string; severity: "INFO" | "WARN" | "ERROR" }>)
    .map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: issue.severity
    }));
  const safety = classifyFillerSafetyMode({
    analysis: context.analysis,
    candidates: selectedCandidates,
    issues: baseIssues
  });

  const run = await prisma.audioEnhancementRun.create({
    data: {
      workspaceId: context.ctx.workspace.id,
      projectId: context.ctx.projectV2.id,
      createdByUserId: context.ctx.user.id,
      mode: "PREVIEW",
      operation: "FILLER_REMOVE",
      status: "PREVIEWED",
      config: {
        input
      },
      summary: {
        selectedCandidateCount: selectedCandidates.length,
        issueCount: transcriptResult.issues.length,
        safetyMode: safety.safetyMode,
        confidenceScore: safety.rationale.confidenceScore,
        safetyReasons: safety.rationale.reasons
      }
    }
  });

  await storeFillerCandidates({
    runId: run.id,
    workspaceId: context.ctx.workspace.id,
    projectId: context.ctx.projectV2.id,
    language: input.language,
    candidates: selectedCandidates,
    status: "PREVIEWED"
  });

  return {
    mode: "PREVIEW" as const,
    runId: run.id,
    candidateCount: selectedCandidates.length,
    candidates: selectedCandidates,
    safetyMode: safety.safetyMode,
    confidenceScore: safety.rationale.confidenceScore,
    safetyReasons: safety.rationale.reasons,
    ...transcriptResult
  };
}

export async function applyFillerRemoval(projectIdOrV2Id: string, input: AudioFillerInput) {
  const context = await loadAudioProjectContext(projectIdOrV2Id, input.language, input.maxCandidates, input.maxConfidence);
  const selectedCandidates = filterCandidates(input, context.fillerCandidates);
  const operations = selectedCandidates.map((candidate) => ({
    op: "delete_range" as const,
    startMs: candidate.startMs,
    endMs: candidate.endMs
  }));

  const transcriptResult = operations.length > 0
    ? await patchTranscript(projectIdOrV2Id, {
        language: input.language,
        operations,
        minConfidenceForRipple: input.minConfidenceForRipple,
        previewOnly: false
      })
    : {
        applied: false,
        suggestionsOnly: true,
        timelineOps: [] as Array<{ op: string; [key: string]: unknown }>,
        issues: [
          {
            code: "NO_FILLER_CANDIDATES",
            message: "No filler candidates matched the current filter.",
            severity: "INFO" as const
          }
        ],
        revisionId: null as string | null
      };
  const baseIssues = (transcriptResult.issues as Array<{ code: string; message: string; severity: "INFO" | "WARN" | "ERROR" }>)
    .map((issue) => ({
      code: issue.code,
      message: issue.message,
      severity: issue.severity
    }));
  const safety = classifyFillerSafetyMode({
    analysis: context.analysis,
    candidates: selectedCandidates,
    issues: baseIssues
  });

  if (safety.safetyMode === "PREVIEW_ONLY" || (safety.safetyMode === "APPLY_WITH_CONFIRM" && input.confirmed !== true)) {
    const issues = [
      ...baseIssues,
      {
        code: safety.safetyMode === "APPLY_WITH_CONFIRM" ? "CONFIRMATION_REQUIRED" : "PREVIEW_ONLY_SAFETY_GATE",
        message: safety.safetyMode === "APPLY_WITH_CONFIRM"
          ? "Apply-with-confirm safety mode requires confirmed=true."
          : "Safety mode requires preview-only path for filler removal.",
        severity: "WARN" as const
      }
    ];
    const run = await prisma.audioEnhancementRun.create({
      data: {
        workspaceId: context.ctx.workspace.id,
        projectId: context.ctx.projectV2.id,
        createdByUserId: context.ctx.user.id,
        mode: "APPLY",
        operation: "FILLER_REMOVE",
        status: "ERROR",
        config: {
          input
        },
        summary: {
          selectedCandidateCount: selectedCandidates.length,
          issueCount: issues.length,
          suggestionsOnly: true,
          safetyMode: safety.safetyMode,
          confidenceScore: safety.rationale.confidenceScore,
          safetyReasons: safety.rationale.reasons
        }
      }
    });
    await storeFillerCandidates({
      runId: run.id,
      workspaceId: context.ctx.workspace.id,
      projectId: context.ctx.projectV2.id,
      language: input.language,
      candidates: selectedCandidates,
      status: "SKIPPED"
    });
    return {
      mode: "APPLY" as const,
      runId: run.id,
      candidateCount: selectedCandidates.length,
      candidates: selectedCandidates,
      applied: false,
      suggestionsOnly: true,
      revisionId: null as string | null,
      timelineOps: transcriptResult.timelineOps,
      issues,
      safetyMode: safety.safetyMode,
      confidenceScore: safety.rationale.confidenceScore,
      safetyReasons: safety.rationale.reasons
    };
  }

  const run = await prisma.audioEnhancementRun.create({
    data: {
      workspaceId: context.ctx.workspace.id,
      projectId: context.ctx.projectV2.id,
      createdByUserId: context.ctx.user.id,
      timelineRevisionId: transcriptResult.revisionId,
      mode: "APPLY",
      operation: "FILLER_REMOVE",
      status: transcriptResult.applied ? "APPLIED" : "ERROR",
      config: {
        input
      },
      summary: {
        selectedCandidateCount: selectedCandidates.length,
        issueCount: transcriptResult.issues.length,
        suggestionsOnly: transcriptResult.suggestionsOnly,
        safetyMode: safety.safetyMode,
        confidenceScore: safety.rationale.confidenceScore,
        safetyReasons: safety.rationale.reasons
      }
    }
  });

  await storeFillerCandidates({
    runId: run.id,
    workspaceId: context.ctx.workspace.id,
    projectId: context.ctx.projectV2.id,
    language: input.language,
    candidates: selectedCandidates,
    status: transcriptResult.applied ? "APPLIED" : "SKIPPED"
  });

  return {
    mode: "APPLY" as const,
    runId: run.id,
    candidateCount: selectedCandidates.length,
    candidates: selectedCandidates,
    safetyMode: safety.safetyMode,
    confidenceScore: safety.rationale.confidenceScore,
    safetyReasons: safety.rationale.reasons,
    ...transcriptResult
  };
}

export async function getAudioSegmentAudition(params: {
  projectIdOrV2Id: string;
  runId?: string;
  startMs: number;
  endMs: number;
  language?: string;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const startMs = Math.max(0, Math.min(params.startMs, params.endMs));
  const endMs = Math.max(startMs + 1, Math.max(params.startMs, params.endMs));
  const language = (params.language ?? "en").trim().toLowerCase();

  const run = params.runId
    ? await prisma.audioEnhancementRun.findFirst({
        where: {
          id: params.runId,
          workspaceId: ctx.workspace.id,
          projectId: ctx.projectV2.id
        }
      })
    : await prisma.audioEnhancementRun.findFirst({
        where: {
          workspaceId: ctx.workspace.id,
          projectId: ctx.projectV2.id,
          status: {
            in: ["PREVIEWED", "APPLIED"]
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });

  const overlappingSegments = await prisma.transcriptSegment.findMany({
    where: {
      projectId: ctx.projectV2.id,
      language,
      OR: [
        { startMs: { lte: endMs }, endMs: { gte: startMs } }
      ]
    },
    orderBy: {
      startMs: "asc"
    },
    take: 6
  });
  const transcriptSnippet = sanitizeOverlayText(
    overlappingSegments.map((segment) => segment.text).join(" ").slice(0, 280),
    "audio_segment"
  );

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    language,
    segment: {
      startMs,
      endMs,
      durationMs: endMs - startMs
    },
    run: run
      ? {
          id: run.id,
          operation: run.operation,
          mode: run.mode,
          status: run.status,
          createdAt: run.createdAt.toISOString()
        }
      : null,
    audition: {
      beforeLabel: "Original",
      afterLabel: "Enhanced",
      supported: Boolean(run),
      transcriptSnippet,
      recommendedLoopCount: endMs - startMs <= 3000 ? 3 : 2,
      note: run
        ? "Use solo preview for focused audition and bypass to compare against original."
        : "Run audio preview/apply first to compare before/after audition metadata."
    }
  };
}
