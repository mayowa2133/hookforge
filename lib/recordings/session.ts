import { randomUUID } from "crypto";
import { z } from "zod";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  getMultipartPartPresignedUrl,
  type CompletedMultipartPart
} from "@/lib/storage";
import { buildProjectStorageKey } from "@/lib/storage";
import { summarizeRecordingProgress } from "@/lib/recordings/progress";

export { summarizeRecordingProgress } from "@/lib/recordings/progress";

export const RECORDING_SESSION_TTL_SEC = 60 * 60 * 24;
export const RECORDING_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const RECORDING_DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024;
export const RECORDING_MAX_PART_SIZE_BYTES = 64 * 1024 * 1024;

export const RecordingModeSchema = z.enum(["SCREEN", "CAMERA", "MIC", "SCREEN_CAMERA"]);
export type RecordingMode = z.infer<typeof RecordingModeSchema>;

export type RecordingSessionStatus = "ACTIVE" | "FINALIZING" | "COMPLETED" | "CANCELED" | "FAILED";

export type RecordingChunk = {
  partNumber: number;
  eTag: string;
  checksumSha256: string | null;
  uploadedAt: string;
};

export type RecordingSession = {
  id: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  mode: RecordingMode;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadId: string;
  totalParts: number;
  partSizeBytes: number;
  language: string;
  autoTranscribe: boolean;
  status: RecordingSessionStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  failedReason: string | null;
  finalizedAssetId: string | null;
  finalizeAiJobId: string | null;
};

export const RecordingSessionCreateSchema = z.object({
  mode: RecordingModeSchema,
  fileName: z.string().min(1).max(220),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  totalParts: z.number().int().min(1).max(10_000),
  partSizeBytes: z.number().int().min(RECORDING_MIN_PART_SIZE_BYTES).max(RECORDING_MAX_PART_SIZE_BYTES).optional(),
  autoTranscribe: z.boolean().optional(),
  language: z.string().min(2).max(12).optional()
});

export const RecordingChunkUpsertSchema = z.object({
  partNumber: z.number().int().min(1),
  eTag: z.string().min(1).max(512).optional(),
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, "checksumSha256 must be a 64-char hex string")
    .optional()
});

const recordingMetaKey = (sessionId: string) => `hookforge:recording:${sessionId}:meta`;
const recordingPartsKey = (sessionId: string) => `hookforge:recording:${sessionId}:parts`;

async function runWithRedis<T>(fn: (client: any) => Promise<T>) {
  const { withRedis } = await import("@/lib/redis");
  return withRedis(fn);
}

function parseSession(raw: string | null) {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as RecordingSession;
  } catch {
    return null;
  }
}

async function saveSession(session: RecordingSession) {
  await runWithRedis(async (client) => {
    const multi = client.multi();
    multi.set(recordingMetaKey(session.id), JSON.stringify(session), "EX", RECORDING_SESSION_TTL_SEC);
    multi.expire(recordingPartsKey(session.id), RECORDING_SESSION_TTL_SEC);
    await multi.exec();
  });
}

export async function createRecordingSession(params: {
  userId: string;
  workspaceId: string;
  projectId: string;
  mode: RecordingMode;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  totalParts: number;
  partSizeBytes?: number;
  autoTranscribe?: boolean;
  language?: string;
}) {
  const storageKey = buildProjectStorageKey(params.projectId, `recording-${params.fileName}`);
  const uploadId = await createMultipartUpload(storageKey, params.mimeType);
  const now = new Date().toISOString();

  const session: RecordingSession = {
    id: randomUUID(),
    userId: params.userId,
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    mode: params.mode,
    fileName: params.fileName,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    storageKey,
    uploadId,
    totalParts: params.totalParts,
    partSizeBytes: params.partSizeBytes ?? RECORDING_DEFAULT_PART_SIZE_BYTES,
    language: params.language?.trim().toLowerCase() || "en",
    autoTranscribe: params.autoTranscribe ?? true,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    failedReason: null,
    finalizedAssetId: null,
    finalizeAiJobId: null
  };

  await runWithRedis(async (client) => {
    const multi = client.multi();
    multi.del(recordingPartsKey(session.id));
    multi.set(recordingMetaKey(session.id), JSON.stringify(session), "EX", RECORDING_SESSION_TTL_SEC);
    multi.expire(recordingPartsKey(session.id), RECORDING_SESSION_TTL_SEC);
    await multi.exec();
  });

  return session;
}

export async function getRecordingSession(sessionId: string) {
  return runWithRedis(async (client) => parseSession(await client.get(recordingMetaKey(sessionId))));
}

export async function requireRecordingSessionForUser(sessionId: string, userId: string, allowTerminal = false) {
  const session = await getRecordingSession(sessionId);
  if (!session) {
    throw new Error("Recording session not found");
  }
  if (session.userId !== userId) {
    throw new Error("Unauthorized");
  }
  if (!allowTerminal && session.status !== "ACTIVE") {
    throw new Error(`Recording session is ${session.status.toLowerCase()}`);
  }
  return session;
}

export async function getRecordingChunkUploadUrl(sessionId: string, partNumber: number) {
  const session = await getRecordingSession(sessionId);
  if (!session) {
    throw new Error("Recording session not found");
  }
  if (session.status !== "ACTIVE") {
    throw new Error(`Recording session is ${session.status.toLowerCase()}`);
  }
  return getMultipartPartPresignedUrl({
    storageKey: session.storageKey,
    uploadId: session.uploadId,
    partNumber
  });
}

export async function upsertRecordingChunk(params: {
  sessionId: string;
  partNumber: number;
  eTag: string;
  checksumSha256?: string;
}) {
  await runWithRedis(async (client) => {
    const multi = client.multi();
    multi.hset(
      recordingPartsKey(params.sessionId),
      String(params.partNumber),
      JSON.stringify({
        eTag: params.eTag,
        checksumSha256: params.checksumSha256 ?? null,
        uploadedAt: new Date().toISOString()
      })
    );
    multi.expire(recordingPartsKey(params.sessionId), RECORDING_SESSION_TTL_SEC);
    await multi.exec();
  });
}

export async function listRecordingChunks(sessionId: string): Promise<RecordingChunk[]> {
  return runWithRedis(async (client) => {
    const raw = (await client.hgetall(recordingPartsKey(sessionId))) as Record<string, string>;
    return Object.entries(raw)
      .map(([partNumberRaw, payload]) => {
        const partNumber = Number(partNumberRaw);
        try {
          const parsed = JSON.parse(payload) as {
            eTag: string;
            checksumSha256?: string | null;
            uploadedAt?: string;
          };
          return {
            partNumber,
            eTag: parsed.eTag,
            checksumSha256: parsed.checksumSha256 ?? null,
            uploadedAt: parsed.uploadedAt ?? new Date().toISOString()
          };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is RecordingChunk => entry !== null && Number.isInteger(entry.partNumber) && entry.partNumber > 0)
      .sort((a, b) => a.partNumber - b.partNumber);
  });
}

export async function updateRecordingSessionStatus(params: {
  sessionId: string;
  status: RecordingSessionStatus;
  failedReason?: string | null;
  finalizedAssetId?: string | null;
  finalizeAiJobId?: string | null;
  completedAt?: string | null;
}) {
  const current = await getRecordingSession(params.sessionId);
  if (!current) {
    throw new Error("Recording session not found");
  }
  const next: RecordingSession = {
    ...current,
    status: params.status,
    updatedAt: new Date().toISOString(),
    failedReason: params.failedReason ?? current.failedReason,
    finalizedAssetId: params.finalizedAssetId ?? current.finalizedAssetId,
    finalizeAiJobId: params.finalizeAiJobId ?? current.finalizeAiJobId,
    completedAt: params.completedAt ?? (params.status === "COMPLETED" ? new Date().toISOString() : current.completedAt)
  };
  await saveSession(next);
  return next;
}

export async function completeRecordingSessionMultipart(sessionId: string) {
  const session = await getRecordingSession(sessionId);
  if (!session) {
    throw new Error("Recording session not found");
  }
  const chunks = await listRecordingChunks(sessionId);
  const progress = summarizeRecordingProgress(session.totalParts, chunks);
  if (progress.remainingParts > 0) {
    throw new Error("Cannot finalize recording: missing chunk uploads");
  }

  const parts: CompletedMultipartPart[] = chunks.map((chunk) => ({
    partNumber: chunk.partNumber,
    eTag: chunk.eTag
  }));
  await completeMultipartUpload({
    storageKey: session.storageKey,
    uploadId: session.uploadId,
    parts
  });
  return {
    session,
    chunks,
    progress
  };
}

export async function cancelRecordingSessionUpload(sessionId: string) {
  const session = await getRecordingSession(sessionId);
  if (!session) {
    throw new Error("Recording session not found");
  }
  await abortMultipartUpload({
    storageKey: session.storageKey,
    uploadId: session.uploadId
  });
}
