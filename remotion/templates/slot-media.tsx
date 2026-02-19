import { CSSProperties } from "react";
import { AbsoluteFill, Img, Video } from "remotion";
import type { RemotionAsset } from "../types";

type SlotMediaProps = {
  asset?: RemotionAsset;
  style?: CSSProperties;
  volume?: number;
};

export function SlotMedia({ asset, style, volume = 1 }: SlotMediaProps) {
  if (!asset) {
    return (
      <AbsoluteFill style={{ ...style, alignItems: "center", justifyContent: "center", background: "#111827", color: "white" }}>
        Missing asset
      </AbsoluteFill>
    );
  }

  if (asset.kind === "IMAGE") {
    return <Img src={asset.src} style={{ width: "100%", height: "100%", objectFit: "cover", ...style }} />;
  }

  return <Video src={asset.src} volume={volume} style={{ width: "100%", height: "100%", objectFit: "cover", ...style }} />;
}
