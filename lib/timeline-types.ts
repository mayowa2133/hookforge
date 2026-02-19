export type TimelinePreset = "tiktok_9x16" | "reels_9x16" | "youtube_shorts_9x16" | "custom";

export type TimelineKeyframeValue = string | number | boolean;

export type TimelineKeyframe = {
  id: string;
  property: string;
  timeMs: number;
  value: TimelineKeyframeValue;
  easing?: string;
};

export type TimelineEffect = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  keyframes: TimelineKeyframe[];
};

export type TimelineClip = {
  id: string;
  assetId?: string;
  slotKey?: string;
  label?: string;
  timelineInMs: number;
  timelineOutMs: number;
  sourceInMs: number;
  sourceOutMs: number;
  effects: TimelineEffect[];
};

export type TimelineTrackKind = "VIDEO" | "AUDIO" | "CAPTION";

export type TimelineTrack = {
  id: string;
  kind: TimelineTrackKind;
  name: string;
  order: number;
  muted: boolean;
  volume: number;
  clips: TimelineClip[];
};

export type TimelineOperation =
  | {
      op: "create_track";
      trackId?: string;
      kind: TimelineTrackKind;
      name: string;
    }
  | {
      op: "add_clip";
      clipId?: string;
      trackId: string;
      label?: string;
      assetId?: string;
      slotKey?: string;
      timelineInMs: number;
      durationMs: number;
      sourceInMs?: number;
      sourceOutMs?: number;
    }
  | {
      op: "split_clip";
      trackId: string;
      clipId: string;
      splitMs: number;
    }
  | {
      op: "trim_clip";
      trackId: string;
      clipId: string;
      trimStartMs?: number;
      trimEndMs?: number;
    }
  | {
      op: "reorder_track";
      trackId: string;
      order: number;
    }
  | {
      op: "remove_clip";
      trackId: string;
      clipId: string;
    }
  | {
      op: "move_clip";
      trackId: string;
      clipId: string;
      timelineInMs: number;
    }
  | {
      op: "set_clip_timing";
      trackId: string;
      clipId: string;
      timelineInMs: number;
      durationMs: number;
    }
  | {
      op: "merge_clip_with_next";
      trackId: string;
      clipId: string;
    }
  | {
      op: "set_clip_label";
      trackId: string;
      clipId: string;
      label: string;
    }
  | {
      op: "set_track_audio";
      trackId: string;
      volume?: number;
      muted?: boolean;
    }
  | {
      op: "add_effect";
      trackId: string;
      clipId: string;
      effectType: string;
      config?: Record<string, unknown>;
    }
  | {
      op: "upsert_effect";
      trackId: string;
      clipId: string;
      effectType: string;
      config?: Record<string, unknown>;
    }
  | {
      op: "set_transition";
      trackId: string;
      clipId: string;
      transitionType: "cut" | "crossfade" | "slide";
      durationMs: number;
    }
  | {
      op: "set_keyframe";
      trackId: string;
      clipId: string;
      effectId: string;
      property: string;
      timeMs: number;
      value: TimelineKeyframeValue;
      easing?: string;
    }
  | {
      op: "set_export_preset";
      preset: TimelinePreset;
      width?: number;
      height?: number;
    };

export type TimelineRevisionEntry = {
  id: string;
  revision: number;
  createdAt: string;
  timelineHash: string;
  operations: TimelineOperation[];
};

export type TimelineState = {
  version: number;
  fps: number;
  resolution: {
    width: number;
    height: number;
  };
  exportPreset: TimelinePreset;
  tracks: TimelineTrack[];
  revisions: TimelineRevisionEntry[];
};
