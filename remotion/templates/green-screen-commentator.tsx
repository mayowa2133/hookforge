import { AbsoluteFill } from "remotion";
import type { RemotionTemplateProps } from "../types";
import { SlotMedia } from "./slot-media";
import { TimelineEnhancementLayer } from "./timeline-enhancement-layer";

export function GreenScreenCommentatorTemplate({ assets, assetManifest, timelineState, config }: RemotionTemplateProps) {
  const blurBackground = Boolean(config.blurBackground ?? true);
  const cornerRadius = Number(config.foregroundCornerRadius ?? 28);
  const captionText = typeof config.captionText === "string" ? config.captionText : "";

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <SlotMedia
        asset={assets.background}
        style={{
          filter: blurBackground ? "blur(4px)" : "none",
          transform: blurBackground ? "scale(1.03)" : "none"
        }}
      />

      <AbsoluteFill style={{ padding: 42, justifyContent: "flex-end", alignItems: "flex-end" }}>
        <div
          style={{
            width: "44%",
            height: "38%",
            borderRadius: cornerRadius,
            overflow: "hidden",
            border: "4px solid rgba(255,255,255,0.45)",
            boxShadow: "0 20px 80px rgba(0,0,0,0.45)"
          }}
        >
          <SlotMedia asset={assets.foreground} />
        </div>
      </AbsoluteFill>

      {captionText ? (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 56 }}>
          <div
            style={{
              background: "rgba(0, 0, 0, 0.72)",
              color: "white",
              padding: "14px 22px",
              borderRadius: 16,
              fontSize: 36,
              fontWeight: 700,
              maxWidth: "90%",
              textAlign: "center"
            }}
          >
            {captionText}
          </div>
        </AbsoluteFill>
      ) : null}

      <TimelineEnhancementLayer assets={assets} assetManifest={assetManifest} config={config} timelineState={timelineState} />
    </AbsoluteFill>
  );
}
