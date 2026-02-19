export type RemotionAsset = {
  id?: string;
  slotKey?: string;
  src: string;
  kind: string;
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  mimeType: string;
};

export type RemotionTimelineKeyframe = {
  id: string;
  property: string;
  timeMs: number;
  value: string | number | boolean;
  easing?: string;
};

export type RemotionTimelineEffect = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  keyframes: RemotionTimelineKeyframe[];
};

export type RemotionTimelineClip = {
  id: string;
  assetId?: string;
  slotKey?: string;
  label?: string;
  timelineInMs: number;
  timelineOutMs: number;
  sourceInMs: number;
  sourceOutMs: number;
  effects: RemotionTimelineEffect[];
};

export type RemotionTimelineTrack = {
  id: string;
  kind: "VIDEO" | "AUDIO" | "CAPTION";
  name: string;
  order: number;
  muted: boolean;
  volume: number;
  clips: RemotionTimelineClip[];
};

export type RemotionTimelineState = {
  version: number;
  fps: number;
  resolution: {
    width: number;
    height: number;
  };
  exportPreset: "tiktok_9x16" | "reels_9x16" | "youtube_shorts_9x16" | "custom";
  tracks: RemotionTimelineTrack[];
  revisions: Array<{
    id: string;
    revision: number;
    createdAt: string;
    timelineHash: string;
    operations: unknown[];
  }>;
};

export type RemotionTemplateProps = {
  assets: Record<string, RemotionAsset>;
  assetManifest?: Record<string, RemotionAsset>;
  timelineState?: RemotionTimelineState | null;
  config: Record<string, string | number | boolean>;
  durationInFrames: number;
  fps: number;
};
