import { AbsoluteFill, Audio, Img, Sequence, Video, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  RemotionAsset,
  RemotionTemplateProps,
  RemotionTimelineClip,
  RemotionTimelineEffect,
  RemotionTimelineTrack
} from "../types";

type TimelineEnhancementLayerProps = Pick<RemotionTemplateProps, "assets" | "assetManifest" | "config" | "timelineState">;

const libraryAudioMap: Record<string, string> = {
  "library:sfx-boom": "/demo-assets/sfx-boom.wav",
  "library:sfx-ring": "/demo-assets/sfx-ring.wav",
  "library:sfx-notify": "/demo-assets/sfx-notify.wav",
  "library:music-bed": "/demo-assets/sfx-ring.wav"
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toNumber(value: unknown, fallback: number) {
  if (isFiniteNumber(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function findEffect(clip: RemotionTimelineClip, effectType: string) {
  return clip.effects.find((entry) => entry.type === effectType);
}

function getEffectValueAtMs(effect: RemotionTimelineEffect | undefined, property: string, currentMs: number, fallback: number) {
  if (!effect) {
    return fallback;
  }

  const keyedFrames = effect.keyframes
    .filter((keyframe) => keyframe.property === property && isFiniteNumber(keyframe.value))
    .sort((a, b) => a.timeMs - b.timeMs);

  if (keyedFrames.length === 0) {
    return toNumber(effect.config[property], fallback);
  }

  if (currentMs <= keyedFrames[0].timeMs) {
    return Number(keyedFrames[0].value);
  }

  if (currentMs >= keyedFrames[keyedFrames.length - 1].timeMs) {
    return Number(keyedFrames[keyedFrames.length - 1].value);
  }

  for (let index = 0; index < keyedFrames.length - 1; index += 1) {
    const left = keyedFrames[index];
    const right = keyedFrames[index + 1];
    if (currentMs >= left.timeMs && currentMs <= right.timeMs) {
      const progress = (currentMs - left.timeMs) / Math.max(1, right.timeMs - left.timeMs);
      return interpolate(progress, [0, 1], [Number(left.value), Number(right.value)]);
    }
  }

  return toNumber(effect.config[property], fallback);
}

function resolveAsset({
  clip,
  slotAssets,
  manifest
}: {
  clip: RemotionTimelineClip;
  slotAssets: Record<string, RemotionAsset>;
  manifest: Record<string, RemotionAsset>;
}) {
  if (clip.assetId && manifest[clip.assetId]) {
    return manifest[clip.assetId];
  }

  if (clip.slotKey && slotAssets[clip.slotKey]) {
    return slotAssets[clip.slotKey];
  }

  return undefined;
}

function getTrackCaptionOffset(config: Record<string, string | number | boolean>) {
  const templateCaption = typeof config.captionText === "string" && config.captionText.trim().length > 0;
  return templateCaption ? -0.12 : 0;
}

function VideoClipOverlay({
  clip,
  slotAssets,
  manifest
}: {
  clip: RemotionTimelineClip;
  slotAssets: Record<string, RemotionAsset>;
  manifest: Record<string, RemotionAsset>;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localMs = (frame / fps) * 1000;
  const asset = resolveAsset({ clip, slotAssets, manifest });
  if (!asset) {
    return null;
  }

  const transformEffect = findEffect(clip, "transform");
  const transitionEffect = findEffect(clip, "transition");

  const x = getEffectValueAtMs(transformEffect, "x", localMs, 0.72);
  const y = getEffectValueAtMs(transformEffect, "y", localMs, 0.72);
  const widthPct = getEffectValueAtMs(transformEffect, "widthPct", localMs, 0.36);
  const heightPct = getEffectValueAtMs(transformEffect, "heightPct", localMs, 0.32);
  const scale = getEffectValueAtMs(transformEffect, "scale", localMs, 1);
  const rotationDeg = getEffectValueAtMs(transformEffect, "rotationDeg", localMs, 0);
  const opacityBase = getEffectValueAtMs(transformEffect, "opacity", localMs, 1);
  const radius = getEffectValueAtMs(transformEffect, "radius", localMs, 24);
  const borderWidth = getEffectValueAtMs(transformEffect, "borderWidth", localMs, 2);

  const transitionType = String(transitionEffect?.config.transitionType ?? "cut");
  const transitionDurationMs = Math.max(40, toNumber(transitionEffect?.config.durationMs, 180));
  const transitionProgress = Math.max(0, Math.min(1, localMs / transitionDurationMs));

  const opacity = transitionType === "crossfade" ? interpolate(transitionProgress, [0, 1], [0, opacityBase]) : opacityBase;
  const transitionTranslate = transitionType === "slide" ? interpolate(transitionProgress, [0, 1], [120, 0]) : 0;

  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <div
        style={{
          position: "absolute",
          left: `${Math.max(0, Math.min(1, x)) * 100}%`,
          top: `${Math.max(0, Math.min(1, y)) * 100}%`,
          width: `${Math.max(0.1, Math.min(1, widthPct)) * 100}%`,
          height: `${Math.max(0.1, Math.min(1, heightPct)) * 100}%`,
          transform: `translate(-50%, -50%) translateY(${transitionTranslate}px) scale(${scale}) rotate(${rotationDeg}deg)`,
          opacity,
          borderRadius: radius,
          overflow: "hidden",
          border: `${Math.max(0, borderWidth)}px solid rgba(255,255,255,0.55)`,
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)"
        }}
      >
        {asset.kind === "IMAGE" ? (
          <Img src={asset.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Video src={asset.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
    </AbsoluteFill>
  );
}

function CaptionClipOverlay({
  clip,
  config
}: {
  clip: RemotionTimelineClip;
  config: Record<string, string | number | boolean>;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localMs = (frame / fps) * 1000;
  const transformEffect = findEffect(clip, "transform");

  const x = getEffectValueAtMs(transformEffect, "x", localMs, 0.5);
  const y = getEffectValueAtMs(transformEffect, "y", localMs, 0.8 + getTrackCaptionOffset(config));
  const widthPct = getEffectValueAtMs(transformEffect, "widthPct", localMs, 0.86);
  const opacity = getEffectValueAtMs(transformEffect, "opacity", localMs, 1);
  const scale = getEffectValueAtMs(transformEffect, "scale", localMs, 1);
  const fontSize = getEffectValueAtMs(transformEffect, "fontSize", localMs, 42);

  const styleEffect = findEffect(clip, "caption_style");
  const bgOpacity = getEffectValueAtMs(styleEffect, "bgOpacity", localMs, 0.72);
  const radius = getEffectValueAtMs(styleEffect, "radius", localMs, 16);
  const paddingX = getEffectValueAtMs(styleEffect, "paddingX", localMs, 22);
  const paddingY = getEffectValueAtMs(styleEffect, "paddingY", localMs, 14);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${Math.max(0, Math.min(1, x)) * 100}%`,
          top: `${Math.max(0, Math.min(1, y)) * 100}%`,
          width: `${Math.max(0.2, Math.min(1, widthPct)) * 100}%`,
          transform: `translate(-50%, -50%) scale(${scale})`,
          opacity,
          textAlign: "center"
        }}
      >
        <div
          style={{
            display: "inline-block",
            width: "100%",
            color: "white",
            background: `rgba(0, 0, 0, ${Math.max(0, Math.min(1, bgOpacity))})`,
            borderRadius: radius,
            fontSize,
            fontWeight: 700,
            padding: `${paddingY}px ${paddingX}px`
          }}
        >
          {clip.label ?? ""}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function AudioTrackClip({
  clip,
  track,
  slotAssets,
  manifest
}: {
  clip: RemotionTimelineClip;
  track: RemotionTimelineTrack;
  slotAssets: Record<string, RemotionAsset>;
  manifest: Record<string, RemotionAsset>;
}) {
  const sourceIn = Math.max(0, Math.round((clip.sourceInMs / 1000) * 30));
  const sourceOut = Math.max(sourceIn + 1, Math.round((clip.sourceOutMs / 1000) * 30));
  const normalizedVolume = Math.max(0, Math.min(2, track.volume));

  if (clip.slotKey && libraryAudioMap[clip.slotKey]) {
    return <Audio src={staticFile(libraryAudioMap[clip.slotKey])} volume={normalizedVolume} startFrom={sourceIn} endAt={sourceOut} />;
  }

  const asset = resolveAsset({ clip, slotAssets, manifest });
  if (!asset) {
    return null;
  }

  return <Audio src={asset.src} volume={normalizedVolume} startFrom={sourceIn} endAt={sourceOut} />;
}

export function TimelineEnhancementLayer({ assets, assetManifest, config, timelineState }: TimelineEnhancementLayerProps) {
  const { fps } = useVideoConfig();
  if (!timelineState || !Array.isArray(timelineState.tracks) || timelineState.tracks.length === 0) {
    return null;
  }

  const manifest = assetManifest ?? {};
  const tracks = [...timelineState.tracks].sort((a, b) => a.order - b.order);

  return (
    <>
      {tracks.map((track) => {
        if (track.muted) {
          return null;
        }

        return track.clips.map((clip) => {
          const from = Math.max(0, Math.floor((clip.timelineInMs / 1000) * fps));
          const durationInFrames = Math.max(1, Math.floor(((clip.timelineOutMs - clip.timelineInMs) / 1000) * fps));
          const key = `${track.id}-${clip.id}`;

          if (track.kind === "AUDIO") {
            return (
              <Sequence key={key} from={from} durationInFrames={durationInFrames}>
                <AudioTrackClip clip={clip} track={track} slotAssets={assets} manifest={manifest} />
              </Sequence>
            );
          }

          if (track.kind === "CAPTION") {
            return (
              <Sequence key={key} from={from} durationInFrames={durationInFrames}>
                <CaptionClipOverlay clip={clip} config={config} />
              </Sequence>
            );
          }

          return (
            <Sequence key={key} from={from} durationInFrames={durationInFrames}>
              <VideoClipOverlay clip={clip} slotAssets={assets} manifest={manifest} />
            </Sequence>
          );
        });
      })}
    </>
  );
}
