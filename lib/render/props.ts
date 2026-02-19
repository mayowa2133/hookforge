import { type Asset, type Template } from "@prisma/client";
import { sanitizeOverlayText } from "../sanitize";
import { parseTemplateSlotSchema, validateAndMergeConfig } from "../template-runtime";
import { timelineStateFromConfig } from "../timeline-legacy";
import type { RemotionTimelineState } from "@/remotion/types";

export type RenderAsset = Asset & {
  signedUrl: string;
};

export type TemplateRenderProps = {
  assets: Record<
    string,
    {
      id?: string;
      slotKey?: string;
      src: string;
      kind: string;
      durationSec?: number | null;
      width?: number | null;
      height?: number | null;
      mimeType: string;
    }
  >;
  assetManifest: Record<
    string,
    {
      id?: string;
      slotKey?: string;
      src: string;
      kind: string;
      durationSec?: number | null;
      width?: number | null;
      height?: number | null;
      mimeType: string;
    }
  >;
  timelineState?: RemotionTimelineState | null;
  config: Record<string, string | number | boolean>;
  durationInFrames: number;
  fps: number;
};

export function estimateDurationInFrames(
  templateSlug: string,
  assets: RenderAsset[],
  config: Record<string, string | number | boolean>,
  fps = 30
) {
  const bySlot = Object.fromEntries(assets.map((asset) => [asset.slotKey, asset]));
  const safeMainDuration = Math.max(4, bySlot.main?.durationSec ?? bySlot.foreground?.durationSec ?? bySlot.top?.durationSec ?? 6);

  if (templateSlug === "three-beat-montage-intro-main-talk") {
    const beatDuration = Number(config.beatDurationSec ?? 0.5);
    return Math.ceil((safeMainDuration + beatDuration * 3) * fps);
  }

  if (templateSlug === "fake-facetime-incoming-call") {
    const ringDuration = Number(config.ringDurationSec ?? 2);
    return Math.ceil((safeMainDuration + ringDuration) * fps);
  }

  if (templateSlug === "split-screen-reaction") {
    const topDuration = bySlot.top?.durationSec ?? safeMainDuration;
    const bottomDuration = bySlot.bottom?.durationSec ?? safeMainDuration;
    return Math.ceil(Math.max(topDuration, bottomDuration) * fps);
  }

  return Math.ceil(safeMainDuration * fps);
}

export function mapProjectToRenderProps(template: Template, assets: RenderAsset[], configInput: unknown, fps = 30) {
  const schema = parseTemplateSlotSchema(template.slotSchema);
  const config = validateAndMergeConfig(template, configInput);
  const bySlot = Object.fromEntries(assets.map((asset) => [asset.slotKey, asset]));

  const missingSlots = schema.slots.filter((slot) => slot.required && !bySlot[slot.key]);
  if (missingSlots.length > 0) {
    throw new Error(`Cannot render. Missing required slots: ${missingSlots.map((slot) => slot.key).join(", ")}`);
  }

  const normalizedAssets: TemplateRenderProps["assets"] = {};
  const assetManifest: TemplateRenderProps["assetManifest"] = {};

  for (const slot of schema.slots) {
    const asset = bySlot[slot.key];
    if (!asset) continue;
    normalizedAssets[slot.key] = {
      id: asset.id,
      slotKey: slot.key,
      src: asset.signedUrl,
      kind: asset.kind,
      durationSec: asset.durationSec,
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType
    };
  }

  for (const asset of assets) {
    assetManifest[asset.id] = {
      id: asset.id,
      slotKey: asset.slotKey,
      src: asset.signedUrl,
      kind: asset.kind,
      durationSec: asset.durationSec,
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType
    };
  }

  if (typeof config.callerName === "string") {
    config.callerName = sanitizeOverlayText(config.callerName, "Creator Hotline");
  }

  if (typeof config.captionText === "string") {
    config.captionText = sanitizeOverlayText(config.captionText, "");
  }

  const timelineState = timelineStateFromConfig(configInput) as RemotionTimelineState | null;
  const timelineFrames = timelineState
    ? Math.max(
        0,
        ...timelineState.tracks.flatMap((track) =>
          track.clips.map((clip) => Math.ceil((Math.max(0, clip.timelineOutMs) / 1000) * fps))
        )
      )
    : 0;
  const durationInFrames = Math.max(60, estimateDurationInFrames(template.slug, assets, config, fps), timelineFrames);

  return {
    compositionId: template.slug,
    inputProps: {
      assets: normalizedAssets,
      assetManifest,
      timelineState,
      config,
      durationInFrames,
      fps
    } satisfies TemplateRenderProps,
    durationInFrames,
    fps
  };
}
