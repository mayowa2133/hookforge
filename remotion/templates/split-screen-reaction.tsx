import { AbsoluteFill } from "remotion";
import type { RemotionTemplateProps } from "../types";
import { SlotMedia } from "./slot-media";
import { TimelineEnhancementLayer } from "./timeline-enhancement-layer";

export function SplitScreenReactionTemplate({ assets, assetManifest, timelineState, config }: RemotionTemplateProps) {
  const showBorder = Boolean(config.showBorder ?? true);
  const topVolume = Number(config.topVolume ?? 1);
  const bottomVolume = Number(config.bottomVolume ?? 0.3);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateRows: "1fr 1fr" }}>
        <div style={{ overflow: "hidden" }}>
          <SlotMedia asset={assets.top} volume={topVolume} />
        </div>
        <div style={{ overflow: "hidden" }}>
          <SlotMedia asset={assets.bottom} volume={bottomVolume} />
        </div>
      </div>
      {showBorder ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            height: 6,
            marginTop: -3,
            background: "rgba(255,255,255,0.8)"
          }}
        />
      ) : null}

      <TimelineEnhancementLayer assets={assets} assetManifest={assetManifest} config={config} timelineState={timelineState} />
    </AbsoluteFill>
  );
}
