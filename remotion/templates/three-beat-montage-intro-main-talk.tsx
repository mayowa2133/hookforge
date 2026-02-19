import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import type { RemotionTemplateProps } from "../types";
import { SlotMedia } from "./slot-media";
import { TimelineEnhancementLayer } from "./timeline-enhancement-layer";

export function ThreeBeatMontageIntroTemplate({ assets, assetManifest, timelineState, config }: RemotionTemplateProps) {
  const { fps } = useVideoConfig();
  const beatFrames = Math.max(1, Math.floor(Number(config.beatDurationSec ?? 0.5) * fps));
  const includeBoomSfx = Boolean(config.includeBoomSfx ?? true);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Sequence from={0} durationInFrames={beatFrames}>
        <SlotMedia asset={assets.montage_1} />
      </Sequence>
      <Sequence from={beatFrames} durationInFrames={beatFrames}>
        <SlotMedia asset={assets.montage_2} />
      </Sequence>
      <Sequence from={beatFrames * 2} durationInFrames={beatFrames}>
        <SlotMedia asset={assets.montage_3} />
      </Sequence>

      <Sequence from={beatFrames * 3}>
        <SlotMedia asset={assets.main} />
      </Sequence>

      {includeBoomSfx ? (
        <>
          <Audio src={staticFile("/demo-assets/sfx-boom.wav")} startFrom={0} />
          <Audio src={staticFile("/demo-assets/sfx-boom.wav")} startFrom={beatFrames} />
          <Audio src={staticFile("/demo-assets/sfx-boom.wav")} startFrom={beatFrames * 2} />
        </>
      ) : null}

      <TimelineEnhancementLayer assets={assets} assetManifest={assetManifest} config={config} timelineState={timelineState} />
    </AbsoluteFill>
  );
}
