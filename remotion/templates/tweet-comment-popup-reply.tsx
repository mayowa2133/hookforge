import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { RemotionTemplateProps } from "../types";
import { SlotMedia } from "./slot-media";
import { TimelineEnhancementLayer } from "./timeline-enhancement-layer";

export function TweetCommentPopupReplyTemplate({ assets, assetManifest, timelineState, config }: RemotionTemplateProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const overlayFrame = Math.max(0, Math.floor(Number(config.overlayAppearSec ?? 1) * fps));
  const animation = String(config.animation ?? "pop");
  const withSfx = Boolean(config.notificationSfx ?? false);

  const entrySpring = spring({
    frame: Math.max(0, frame - overlayFrame),
    fps,
    config: {
      damping: 14,
      stiffness: 120
    }
  });

  const translateY = animation === "slide-up" ? interpolate(entrySpring, [0, 1], [80, 0]) : 0;
  const scale = animation === "pop" ? interpolate(entrySpring, [0, 1], [0.72, 1]) : 1;
  const opacity = interpolate(entrySpring, [0, 1], [0, 1]);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <SlotMedia asset={assets.main} />

      <Sequence from={overlayFrame}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 100 }}>
          <div
            style={{
              width: "84%",
              borderRadius: 24,
              overflow: "hidden",
              border: "3px solid rgba(255,255,255,0.92)",
              boxShadow: "0 20px 80px rgba(0,0,0,0.5)",
              backgroundColor: "rgba(0,0,0,0.18)",
              transform: `translateY(${translateY}px) scale(${scale})`,
              opacity
            }}
          >
            <SlotMedia asset={assets.overlay} />
          </div>
        </AbsoluteFill>
      </Sequence>

      {withSfx ? <Audio src={staticFile("/demo-assets/sfx-notify.wav")} startFrom={overlayFrame} /> : null}

      <TimelineEnhancementLayer assets={assets} assetManifest={assetManifest} config={config} timelineState={timelineState} />
    </AbsoluteFill>
  );
}
