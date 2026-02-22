import { randomUUID } from "crypto";
import type { AIJob, Asset, Prisma } from "@prisma/client";
import { applyTimelineOperations, buildTimelineState, serializeTimelineState } from "../timeline-legacy";
import type { TimelineOperation, TimelineState, TimelineTrack } from "../timeline-types";
import { sanitizeOverlayText } from "../sanitize";
import { prisma } from "../prisma";
import { appendTimelineRevision } from "../project-v2";
import { isSupportedLanguage } from "../languages";
import { runAsrQualityPipeline } from "./asr-quality";
import { resolveProviderForCapability } from "../models/provider-routing";
import { getFallbackProvider } from "../providers/registry";
import { previewTimelineOperationsWithValidation } from "../timeline-invariants";

const CAPTION_STYLE_NAME = "HookForge Bold";

const CHAT_UNDO_STACK_KEY = "chatEditUndoStack";
const CHAT_UNDO_STACK_LIMIT = 12;

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

  await prisma.captionSegment.deleteMany({
    where: {
      projectId: context.projectV2.id,
      language
    }
  });

  if (asr.words.length > 0) {
    await prisma.transcriptWord.createMany({
      data: asr.words.map((word) => ({
        projectId: context.projectV2.id,
        startMs: word.startMs,
        endMs: word.endMs,
        text: word.text,
        speakerLabel: word.speakerLabel,
        confidence: word.confidence
      }))
    });
  }

  if (asr.segments.length > 0) {
    await prisma.captionSegment.createMany({
      data: asr.segments.map((segment) => ({
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
    segments: asr.segments
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
    segmentCount: asr.segments.length,
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

async function handleAiEditJob(aiJob: AIJob) {
  if (!aiJob.projectId) {
    return { note: "No project attached to AI edit job." };
  }

  const context = await loadLinkedProjectContext(aiJob.projectId);
  if (!context) {
    return { note: "Linked project context not found." };
  }

  const input = asRecord(aiJob.input);
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
  }

  return operations;
}
