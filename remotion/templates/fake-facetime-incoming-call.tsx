import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { RemotionTemplateProps } from "../types";
import { SlotMedia } from "./slot-media";
import { TimelineEnhancementLayer } from "./timeline-enhancement-layer";

export function FakeFaceTimeIncomingCallTemplate({ assets, assetManifest, timelineState, config }: RemotionTemplateProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const callerName = typeof config.callerName === "string" ? config.callerName : "Creator Hotline";
  const ringFrames = Math.max(1, Math.floor(Number(config.ringDurationSec ?? 2) * fps));

  const fadeOpacity = interpolate(frame, [Math.max(0, ringFrames - 8), ringFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Sequence from={ringFrames}>
        <SlotMedia asset={assets.main} />
      </Sequence>

      <AbsoluteFill
        style={{
          opacity: fadeOpacity,
          background:
            "radial-gradient(circle at 20% 10%, rgba(59,130,246,0.6), transparent 42%), linear-gradient(130deg, #0f172a 0%, #111827 45%, #1e293b 100%)",
          justifyContent: "center",
          alignItems: "center"
        }}
      >
        <div
          style={{
            width: 360,
            height: 360,
            borderRadius: 9999,
            overflow: "hidden",
            border: "8px solid rgba(255,255,255,0.85)",
            boxShadow: "0 30px 100px rgba(0,0,0,0.5)"
          }}
        >
          <SlotMedia asset={assets.caller_photo} />
        </div>
        <div style={{ color: "white", marginTop: 42, textAlign: "center" }}>
          <div style={{ fontSize: 34, opacity: 0.82, letterSpacing: 2 }}>INCOMING CALL</div>
          <div style={{ fontSize: 72, fontWeight: 700, marginTop: 10 }}>{callerName}</div>
          <div style={{ fontSize: 34, marginTop: 22, opacity: 0.84 }}>Swipe up to answer</div>
        </div>
      </AbsoluteFill>

      <Sequence from={0} durationInFrames={ringFrames}>
        <Audio src={staticFile("/demo-assets/sfx-ring.wav")} />
      </Sequence>

      <TimelineEnhancementLayer assets={assets} assetManifest={assetManifest} config={config} timelineState={timelineState} />
    </AbsoluteFill>
  );
}
