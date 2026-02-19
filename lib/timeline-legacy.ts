import { createHash, randomUUID } from "crypto";
import type {
  TimelineClip,
  TimelineEffect,
  TimelineOperation,
  TimelinePreset,
  TimelineState,
  TimelineTrack
} from "@/lib/timeline-types";

type LegacyProjectAsset = {
  id: string;
  slotKey: string;
  kind: "VIDEO" | "IMAGE" | "AUDIO";
  durationSec: number | null;
};

export const TIMELINE_STATE_KEY = "timelineStateJson";

function stableHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function parseTimelineState(rawConfig: unknown): TimelineState | null {
  if (!rawConfig || typeof rawConfig !== "object") {
    return null;
  }

  const encoded = (rawConfig as Record<string, unknown>)[TIMELINE_STATE_KEY];
  if (typeof encoded !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(encoded) as TimelineState;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tracks)) {
      return null;
    }

    if (!Array.isArray(parsed.revisions)) {
      parsed.revisions = [];
    }

    if (typeof parsed.version !== "number") {
      parsed.version = 1;
    }

    return parsed;
  } catch {
    return null;
  }
}

function makeInitialTimeline(assets: LegacyProjectAsset[]): TimelineState {
  const videoAssets = assets.filter((asset) => asset.kind === "VIDEO");
  const audioAssets = assets.filter((asset) => asset.kind === "AUDIO");

  const videoTrack: TimelineTrack = {
    id: randomUUID(),
    kind: "VIDEO",
    name: "Video Track 1",
    order: 0,
    muted: false,
    volume: 1,
    clips: videoAssets.map((asset, idx) => {
      const durationMs = Math.max(1000, Math.floor((asset.durationSec ?? 5) * 1000));
      const offset = idx === 0 ? 0 : idx * 500;
      return {
        id: randomUUID(),
        assetId: asset.id,
        slotKey: asset.slotKey,
        label: asset.slotKey,
        timelineInMs: offset,
        timelineOutMs: offset + durationMs,
        sourceInMs: 0,
        sourceOutMs: durationMs,
        effects: []
      };
    })
  };

  const audioTrack: TimelineTrack = {
    id: randomUUID(),
    kind: "AUDIO",
    name: "Audio Track 1",
    order: 1,
    muted: false,
    volume: 1,
    clips: audioAssets.map((asset) => {
      const durationMs = Math.max(1000, Math.floor((asset.durationSec ?? 5) * 1000));
      return {
        id: randomUUID(),
        assetId: asset.id,
        slotKey: asset.slotKey,
        label: asset.slotKey,
        timelineInMs: 0,
        timelineOutMs: durationMs,
        sourceInMs: 0,
        sourceOutMs: durationMs,
        effects: []
      };
    })
  };

  const initial: TimelineState = {
    version: 1,
    fps: 30,
    resolution: {
      width: 1080,
      height: 1920
    },
    exportPreset: "tiktok_9x16" as TimelinePreset,
    tracks: [videoTrack, audioTrack],
    revisions: []
  };

  initial.revisions.push({
    id: randomUUID(),
    revision: 1,
    createdAt: new Date().toISOString(),
    timelineHash: stableHash(initial),
    operations: []
  });

  return initial;
}

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1.5, value));
}

function clipDurationMs(clip: TimelineClip) {
  return Math.max(120, clip.timelineOutMs - clip.timelineInMs);
}

function sortTracks(state: TimelineState) {
  state.tracks.sort((a, b) => a.order - b.order);
  state.tracks.forEach((track, index) => {
    track.order = index;
    track.clips.sort((clipA, clipB) => clipA.timelineInMs - clipB.timelineInMs);
  });
}

function findTrack(state: TimelineState, trackId: string) {
  const track = state.tracks.find((entry) => entry.id === trackId);
  if (!track) {
    throw new Error(`Track not found: ${trackId}`);
  }
  return track;
}

function findClip(track: TimelineTrack, clipId: string) {
  const clip = track.clips.find((entry) => entry.id === clipId);
  if (!clip) {
    throw new Error(`Clip not found: ${clipId}`);
  }
  return clip;
}

export function applyTimelineOperations(state: TimelineState, operations: TimelineOperation[]) {
  for (const operation of operations) {
    if (operation.op === "create_track") {
      const requestedId = operation.trackId?.trim();
      if (requestedId && state.tracks.some((track) => track.id === requestedId)) {
        throw new Error(`Track already exists: ${requestedId}`);
      }
      state.tracks.push({
        id: requestedId || randomUUID(),
        kind: operation.kind,
        name: operation.name,
        order: state.tracks.length,
        muted: false,
        volume: 1,
        clips: []
      });
      continue;
    }

    if (operation.op === "add_clip") {
      const track = findTrack(state, operation.trackId);
      const durationMs = Math.max(120, operation.durationMs);
      const requestedId = operation.clipId?.trim();
      if (requestedId && track.clips.some((clip) => clip.id === requestedId)) {
        throw new Error(`Clip already exists: ${requestedId}`);
      }
      track.clips.push({
        id: requestedId || randomUUID(),
        assetId: operation.assetId,
        slotKey: operation.slotKey,
        label: operation.label,
        timelineInMs: Math.max(0, operation.timelineInMs),
        timelineOutMs: Math.max(0, operation.timelineInMs) + durationMs,
        sourceInMs: Math.max(0, operation.sourceInMs ?? 0),
        sourceOutMs: Math.max(operation.sourceInMs ?? 0, operation.sourceOutMs ?? durationMs),
        effects: []
      });
      continue;
    }

    if (operation.op === "split_clip") {
      const track = findTrack(state, operation.trackId);
      const clip = findClip(track, operation.clipId);
      const splitPoint = Math.max(clip.timelineInMs + 40, Math.min(operation.splitMs, clip.timelineOutMs - 40));
      const sourceOffset = splitPoint - clip.timelineInMs;

      const secondHalf: TimelineClip = {
        ...clip,
        id: randomUUID(),
        timelineInMs: splitPoint,
        sourceInMs: clip.sourceInMs + sourceOffset
      };
      secondHalf.effects = clip.effects.map((effect) => ({
        ...effect,
        id: randomUUID(),
        keyframes: effect.keyframes.map((keyframe) => ({ ...keyframe, id: randomUUID() }))
      }));

      clip.timelineOutMs = splitPoint;
      clip.sourceOutMs = clip.sourceInMs + sourceOffset;

      const index = track.clips.findIndex((entry) => entry.id === operation.clipId);
      track.clips.splice(index + 1, 0, secondHalf);
      continue;
    }

    if (operation.op === "trim_clip") {
      const track = findTrack(state, operation.trackId);
      const clip = findClip(track, operation.clipId);

      const trimStart = Math.max(0, operation.trimStartMs ?? 0);
      const trimEnd = Math.max(0, operation.trimEndMs ?? 0);
      const duration = clip.timelineOutMs - clip.timelineInMs;
      const nextDuration = Math.max(120, duration - trimStart - trimEnd);

      clip.timelineInMs += trimStart;
      clip.sourceInMs += trimStart;
      clip.timelineOutMs = clip.timelineInMs + nextDuration;
      clip.sourceOutMs = clip.sourceInMs + nextDuration;
      continue;
    }

    if (operation.op === "reorder_track") {
      const track = findTrack(state, operation.trackId);
      track.order = Math.max(0, Math.min(operation.order, state.tracks.length - 1));
      sortTracks(state);
      continue;
    }

    if (operation.op === "move_clip") {
      const track = findTrack(state, operation.trackId);
      const clip = findClip(track, operation.clipId);
      const duration = clipDurationMs(clip);
      clip.timelineInMs = Math.max(0, operation.timelineInMs);
      clip.timelineOutMs = clip.timelineInMs + duration;
      track.clips.sort((clipA, clipB) => clipA.timelineInMs - clipB.timelineInMs);
      continue;
    }

    if (operation.op === "set_clip_timing") {
      const track = findTrack(state, operation.trackId);
      const clip = findClip(track, operation.clipId);
      const nextDuration = Math.max(120, operation.durationMs);
      clip.timelineInMs = Math.max(0, operation.timelineInMs);
      clip.timelineOutMs = clip.timelineInMs + nextDuration;
      clip.sourceOutMs = clip.sourceInMs + nextDuration;
      track.clips.sort((clipA, clipB) => clipA.timelineInMs - clipB.timelineInMs);
      continue;
    }

    if (operation.op === "remove_clip") {
      const track = findTrack(state, operation.trackId);
      const index = track.clips.findIndex((entry) => entry.id === operation.clipId);
      if (index === -1) {
        throw new Error(`Clip not found: ${operation.clipId}`);
      }
      track.clips.splice(index, 1);
      continue;
    }

    if (operation.op === "merge_clip_with_next") {
      const track = findTrack(state, operation.trackId);
      const index = track.clips.findIndex((entry) => entry.id === operation.clipId);
      if (index === -1 || index >= track.clips.length - 1) {
        throw new Error("Clip merge requires a next clip");
      }

      const current = track.clips[index];
      const next = track.clips[index + 1];

      current.timelineOutMs = Math.max(current.timelineOutMs, next.timelineOutMs);
      current.sourceOutMs = Math.max(current.sourceOutMs, next.sourceOutMs);
      current.effects = [...current.effects, ...next.effects];
      track.clips.splice(index + 1, 1);
      continue;
    }

    if (operation.op === "set_clip_label") {
      const track = findTrack(state, operation.trackId);
      const clip = findClip(track, operation.clipId);
      clip.label = operation.label.slice(0, 160);
      continue;
    }

    if (operation.op === "set_track_audio") {
      const track = findTrack(state, operation.trackId);
      if (typeof operation.volume === "number") {
        track.volume = clampVolume(operation.volume);
      }
      if (typeof operation.muted === "boolean") {
        track.muted = operation.muted;
      }
      continue;
    }

    if (operation.op === "add_effect") {
      const track = findTrack(state, operation.trackId);
      const clip = findClip(track, operation.clipId);
      clip.effects.push({
        id: randomUUID(),
        type: operation.effectType,
        config: operation.config ?? {},
        keyframes: []
      });
      continue;
    }

    if (operation.op === "upsert_effect") {
      const track = findTrack(state, operation.trackId);
      const clip = findClip(track, operation.clipId);
      const existing = clip.effects.find((entry) => entry.type === operation.effectType);
      if (existing) {
        existing.config = operation.config ?? {};
      } else {
        clip.effects.push({
          id: randomUUID(),
          type: operation.effectType,
          config: operation.config ?? {},
          keyframes: []
        });
      }
      continue;
    }

    if (operation.op === "set_transition") {
      const track = findTrack(state, operation.trackId);
      const clip = findClip(track, operation.clipId);
      const effect = clip.effects.find((entry) => entry.type === "transition");
      const transitionConfig = {
        transitionType: operation.transitionType,
        durationMs: Math.max(40, Math.floor(operation.durationMs))
      };
      if (effect) {
        effect.config = transitionConfig;
      } else {
        clip.effects.push({
          id: randomUUID(),
          type: "transition",
          config: transitionConfig,
          keyframes: []
        });
      }
      continue;
    }

    if (operation.op === "set_keyframe") {
      const track = findTrack(state, operation.trackId);
      const clip = findClip(track, operation.clipId);
      const effect = clip.effects.find((entry) => entry.id === operation.effectId);
      if (!effect) {
        throw new Error(`Effect not found: ${operation.effectId}`);
      }

      effect.keyframes.push({
        id: randomUUID(),
        property: operation.property,
        timeMs: Math.max(0, operation.timeMs),
        value: operation.value,
        easing: operation.easing
      });
      continue;
    }

    if (operation.op === "set_export_preset") {
      state.exportPreset = operation.preset;
      if (operation.preset === "custom") {
        state.resolution = {
          width: Math.max(120, Math.floor(operation.width ?? state.resolution.width)),
          height: Math.max(120, Math.floor(operation.height ?? state.resolution.height))
        };
      } else {
        state.resolution = { width: 1080, height: 1920 };
      }
    }
  }

  state.version += 1;

  const revisionPayload = {
    version: state.version,
    tracks: state.tracks,
    exportPreset: state.exportPreset,
    resolution: state.resolution
  };
  const hash = stableHash(revisionPayload);

  state.revisions.unshift({
    id: randomUUID(),
    revision: state.version,
    createdAt: new Date().toISOString(),
    timelineHash: hash,
    operations
  });

  state.revisions = state.revisions.slice(0, 50);

  return {
    state,
    timelineHash: hash,
    revision: state.version
  };
}

export function buildTimelineState(rawConfig: unknown, assets: LegacyProjectAsset[]) {
  const parsed = parseTimelineState(rawConfig);
  if (parsed) {
    return parsed;
  }

  return makeInitialTimeline(assets);
}

export function serializeTimelineState(config: Record<string, unknown>, state: TimelineState) {
  return {
    ...config,
    [TIMELINE_STATE_KEY]: JSON.stringify(state)
  };
}

export function timelineStateFromConfig(rawConfig: unknown) {
  return parseTimelineState(rawConfig);
}
