import { AbsoluteFill } from "remotion";
import type { RemotionAsset, RemotionTemplateProps } from "../types";
import { SlotMedia } from "./slot-media";
import { TimelineEnhancementLayer } from "./timeline-enhancement-layer";

function pickPrimaryAsset(assets: Record<string, RemotionAsset>, manifest: Record<string, RemotionAsset>) {
  const preferredKeys = ["seed_media", "main", "foreground", "top", "background"];
  for (const key of preferredKeys) {
    if (assets[key]) {
      return assets[key];
    }
  }

  const manifestAssets = Object.values(manifest);
  const primaryVideo = manifestAssets.find((entry) => entry.kind === "VIDEO");
  if (primaryVideo) {
    return primaryVideo;
  }

  const primaryImage = manifestAssets.find((entry) => entry.kind === "IMAGE");
  if (primaryImage) {
    return primaryImage;
  }

  return manifestAssets[0];
}

export function SystemFreeformEditorTemplate({ assets, assetManifest, config, timelineState }: RemotionTemplateProps) {
  const manifest = assetManifest ?? {};
  const primary = pickPrimaryAsset(assets, manifest);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <SlotMedia asset={primary} />
      <TimelineEnhancementLayer assets={assets} assetManifest={manifest} config={config} timelineState={timelineState} />
    </AbsoluteFill>
  );
}
