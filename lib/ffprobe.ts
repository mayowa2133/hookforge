import ffprobeStatic from "ffprobe-static";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { downloadStorageObjectToTempFile } from "./storage";

const execFileAsync = promisify(execFile);
const staticFfprobePath = (ffprobeStatic as { path?: string }).path;
const ffprobePath = staticFfprobePath && existsSync(staticFfprobePath) ? staticFfprobePath : "ffprobe";

export type MediaProbe = {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  bitRate: number | null;
  fps: number | null;
  keyframeCount: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string | null;
};

function parseFps(value?: string): number | null {
  if (!value || !value.includes("/")) {
    return null;
  }
  const [numeratorRaw, denominatorRaw] = value.split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  duration?: string | number;
  width?: number;
  height?: number;
  bit_rate?: string | number;
  avg_frame_rate?: string;
};

type FfprobeFormat = {
  format_name?: string;
  duration?: string | number;
  bit_rate?: string | number;
};

type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
};

export async function probeMediaFile(filePath: string, options?: { includeKeyframes?: boolean }): Promise<MediaProbe> {
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath
  ]);

  const parsed = JSON.parse(stdout) as FfprobeOutput;
  const streams = parsed.streams ?? [];
  const videoStream = streams.find((entry) => entry.codec_type === "video");
  const audioStream = streams.find((entry) => entry.codec_type === "audio");
  const stream = videoStream ?? streams[0];
  const format = parsed.format ?? {};
  const durationSec = parseNumeric(stream?.duration ?? format.duration);

  const bitRate = parseNumeric(stream?.bit_rate ?? format.bit_rate);

  const fps = parseFps(stream?.avg_frame_rate);

  return {
    durationSec,
    width: stream?.width ?? null,
    height: stream?.height ?? null,
    bitRate,
    fps,
    keyframeCount: options?.includeKeyframes ? await estimateKeyframes(filePath) : null,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    formatName: format.format_name ?? null
  };
}

export async function estimateKeyframes(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_frames",
      "-show_entries",
      "frame=key_frame",
      "-of",
      "json",
      filePath
    ]);

    const parsed = JSON.parse(stdout) as { frames?: Array<{ key_frame?: number }> };
    if (!parsed.frames) {
      return null;
    }
    return parsed.frames.filter((frame) => frame.key_frame === 1).length;
  } catch {
    return null;
  }
}

export async function probeStorageAsset(storageKey: string, options?: { includeKeyframes?: boolean }) {
  const { path, cleanup } = await downloadStorageObjectToTempFile(storageKey);
  try {
    return await probeMediaFile(path, options);
  } finally {
    await cleanup();
  }
}
