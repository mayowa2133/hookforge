import { execFile } from "child_process";
import { mkdir, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { buildProjectStorageKey, downloadStorageObjectToTempFile, uploadFileToStorage } from "./storage";
import { probeMediaFile, type MediaProbe } from "./ffprobe";

const execFileAsync = promisify(execFile);

const SUPPORTED_VIDEO_CODEC = "h264";
const SUPPORTED_AUDIO_CODEC = "aac";
type SubjectIsolationMode = "blur" | "black";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function needsVideoNormalization(mimeType: string, probe: MediaProbe) {
  if (mimeType !== "video/mp4") {
    return true;
  }

  if (probe.videoCodec !== SUPPORTED_VIDEO_CODEC) {
    return true;
  }

  if (probe.audioCodec && probe.audioCodec !== SUPPORTED_AUDIO_CODEC) {
    return true;
  }

  return false;
}

export async function normalizeStorageVideoToMp4(params: {
  storageKey: string;
  projectId: string;
  slotKey: string;
}) {
  const { storageKey, projectId, slotKey } = params;
  const source = await downloadStorageObjectToTempFile(storageKey);

  const tmpOutDir = join(tmpdir(), "hookforge-normalized");
  await mkdir(tmpOutDir, { recursive: true });
  const outputPath = join(tmpOutDir, `${randomUUID()}.mp4`);

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      source.path,
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outputPath
    ]);

    const normalizedStorageKey = buildProjectStorageKey(projectId, `${slotKey}-normalized.mp4`);
    await uploadFileToStorage(normalizedStorageKey, outputPath, "video/mp4");
    const normalizedProbe = await probeMediaFile(outputPath);

    return {
      storageKey: normalizedStorageKey,
      mimeType: "video/mp4",
      probe: normalizedProbe
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video normalization failed";
    throw new Error(`Could not normalize uploaded video. ${message}`);
  } finally {
    await source.cleanup();
    await unlink(outputPath).catch(() => undefined);
  }
}

export async function suppressStorageVideoBackground(params: {
  storageKey: string;
  projectId: string;
  slotKey: string;
  width: number | null;
  height: number | null;
  mode?: string;
  similarity?: number;
  blend?: number;
}) {
  const { storageKey, projectId, slotKey, width, height, mode, similarity, blend } = params;
  const source = await downloadStorageObjectToTempFile(storageKey);

  const tmpOutDir = join(tmpdir(), "hookforge-normalized");
  await mkdir(tmpOutDir, { recursive: true });
  const outputPath = join(tmpOutDir, `${randomUUID()}-suppressed.mp4`);

  try {
    const safeWidth = width && width > 0 ? width : 1080;
    const safeHeight = height && height > 0 ? height : 1920;
    const backgroundCanvas = `${safeWidth}x${safeHeight}`;
    const safeSimilarity = clamp(Number(similarity ?? 0.25), 0.05, 0.6);
    const safeBlend = clamp(Number(blend ?? 0.08), 0, 0.3);
    const safeMode: SubjectIsolationMode = mode === "black" ? "black" : "blur";

    const filterComplex =
      safeMode === "black"
        ? `[0:v]format=rgba,backgroundkey=similarity=${safeSimilarity}:blend=${safeBlend}[fg];color=c=black:s=${backgroundCanvas}:r=30[bg];[bg][fg]overlay=shortest=1:format=auto,format=yuv420p[v]`
        : `[0:v]split=2[fgsrc][bgsrc];[bgsrc]gblur=sigma=32,eq=saturation=0.2:brightness=-0.2[bg];[fgsrc]format=rgba,backgroundkey=similarity=${safeSimilarity}:blend=${safeBlend}[fg];[bg][fg]overlay=shortest=1:format=auto,format=yuv420p[v]`;

    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      source.path,
      "-filter_complex",
      filterComplex,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-movflags",
      "+faststart",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outputPath
    ]);

    const suppressedStorageKey = buildProjectStorageKey(projectId, `${slotKey}-bg-suppressed.mp4`);
    await uploadFileToStorage(suppressedStorageKey, outputPath, "video/mp4");
    const suppressedProbe = await probeMediaFile(outputPath);

    return {
      storageKey: suppressedStorageKey,
      mimeType: "video/mp4",
      probe: suppressedProbe
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Background suppression failed";
    throw new Error(`Could not suppress talking-head background. ${message}`);
  } finally {
    await source.cleanup();
    await unlink(outputPath).catch(() => undefined);
  }
}
