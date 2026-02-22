import { randomUUID } from "crypto";
import { z } from "zod";

export const RESUMABLE_SESSION_TTL_SEC = 60 * 60 * 24;
export const RESUMABLE_MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const RESUMABLE_DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024;
export const RESUMABLE_MAX_PART_SIZE_BYTES = 64 * 1024 * 1024;

export type ResumableUploadStatus = "ACTIVE" | "COMPLETED" | "ABORTED";

export type ResumableUploadSession = {
  id: string;
  userId: string;
  projectId: string;
  slotKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadId: string;
  totalParts: number;
  partSizeBytes: number;
  status: ResumableUploadStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export const ResumableInitiateSchema = z.object({
  projectId: z.string().min(1),
  slotKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(3),
  sizeBytes: z.number().int().positive(),
  totalParts: z.number().int().min(1).max(10000),
  partSizeBytes: z
    .number()
    .int()
    .min(RESUMABLE_MIN_PART_SIZE_BYTES)
    .max(RESUMABLE_MAX_PART_SIZE_BYTES)
    .optional()
});

export const ResumablePartUrlSchema = z.object({
  partNumber: z.number().int().min(1)
});

export const ResumablePartCompleteSchema = z.object({
  partNumber: z.number().int().min(1),
  eTag: z.string().min(1).max(512)
});

function sessionMetaKey(sessionId: string) {
  return `hookforge:mobile:upload:${sessionId}:meta`;
}

function sessionPartsKey(sessionId: string) {
  return `hookforge:mobile:upload:${sessionId}:parts`;
}

function parseStoredSession(raw: string | null) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ResumableUploadSession;
  } catch {
    return null;
  }
}

async function saveSession(session: ResumableUploadSession) {
  await runWithRedis(async (client) => {
    const multi = client.multi();
    multi.set(sessionMetaKey(session.id), JSON.stringify(session), "EX", RESUMABLE_SESSION_TTL_SEC);
    multi.expire(sessionPartsKey(session.id), RESUMABLE_SESSION_TTL_SEC);
    await multi.exec();
  });
}

export function buildResumableProgress(totalParts: number, uploadedPartNumbers: number[]) {
  const uniquePartNumbers = [...new Set(uploadedPartNumbers.filter((part) => Number.isInteger(part) && part > 0))].sort(
    (a, b) => a - b
  );
  const completedParts = Math.min(totalParts, uniquePartNumbers.length);
  const remainingParts = Math.max(0, totalParts - completedParts);
  const missingPartNumbers: number[] = [];

  for (let part = 1; part <= totalParts; part += 1) {
    if (!uniquePartNumbers.includes(part)) {
      missingPartNumbers.push(part);
    }
  }

  const progressPct = totalParts === 0 ? 100 : Math.round((completedParts / totalParts) * 100);

  return {
    totalParts,
    completedParts,
    remainingParts,
    uploadedPartNumbers: uniquePartNumbers,
    missingPartNumbers,
    progressPct
  };
}

export async function createResumableUploadSession(params: {
  userId: string;
  projectId: string;
  slotKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  uploadId: string;
  totalParts: number;
  partSizeBytes?: number;
}) {
  const now = new Date().toISOString();
  const session: ResumableUploadSession = {
    id: randomUUID(),
    userId: params.userId,
    projectId: params.projectId,
    slotKey: params.slotKey,
    fileName: params.fileName,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    storageKey: params.storageKey,
    uploadId: params.uploadId,
    totalParts: params.totalParts,
    partSizeBytes: params.partSizeBytes ?? RESUMABLE_DEFAULT_PART_SIZE_BYTES,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    completedAt: null
  };

  await runWithRedis(async (client) => {
    const multi = client.multi();
    multi.del(sessionPartsKey(session.id));
    multi.set(sessionMetaKey(session.id), JSON.stringify(session), "EX", RESUMABLE_SESSION_TTL_SEC);
    multi.expire(sessionPartsKey(session.id), RESUMABLE_SESSION_TTL_SEC);
    await multi.exec();
  });

  return session;
}

export async function getResumableUploadSession(sessionId: string) {
  return runWithRedis(async (client) => parseStoredSession(await client.get(sessionMetaKey(sessionId))));
}

export async function requireResumableUploadSessionForUser(
  sessionId: string,
  userId: string,
  options?: { allowTerminal?: boolean }
) {
  const session = await getResumableUploadSession(sessionId);
  if (!session) {
    throw new Error("Resumable upload session not found");
  }
  if (session.userId !== userId) {
    throw new Error("Unauthorized");
  }
  if (!options?.allowTerminal && session.status !== "ACTIVE") {
    throw new Error(`Resumable upload session is ${session.status.toLowerCase()}`);
  }
  return session;
}

export async function markResumablePartUploaded(sessionId: string, partNumber: number, eTag: string) {
  await runWithRedis(async (client) => {
    const multi = client.multi();
    multi.hset(sessionPartsKey(sessionId), String(partNumber), eTag);
    multi.expire(sessionPartsKey(sessionId), RESUMABLE_SESSION_TTL_SEC);
    await multi.exec();
  });
}

export async function listResumableUploadedParts(sessionId: string) {
  return runWithRedis(async (client) => {
    const raw = (await client.hgetall(sessionPartsKey(sessionId))) as Record<string, string>;
    const parts = Object.entries(raw)
      .map(([partNumberRaw, eTagRaw]) => ({
        partNumber: Number(partNumberRaw),
        eTag: String(eTagRaw)
      }))
      .filter((entry) => Number.isInteger(entry.partNumber) && entry.partNumber > 0 && entry.eTag.length > 0)
      .sort((a, b) => a.partNumber - b.partNumber);
    return parts;
  });
}

export async function updateResumableUploadSessionStatus(
  sessionId: string,
  status: ResumableUploadStatus,
  options?: { completedAt?: string | null }
) {
  const current = await getResumableUploadSession(sessionId);
  if (!current) {
    throw new Error("Resumable upload session not found");
  }

  const next: ResumableUploadSession = {
    ...current,
    status,
    updatedAt: new Date().toISOString(),
    completedAt: options?.completedAt ?? (status === "COMPLETED" ? new Date().toISOString() : current.completedAt)
  };

  await saveSession(next);
  return next;
}

export async function clearResumableUploadSession(sessionId: string) {
  await runWithRedis(async (client) => {
    const multi = client.multi();
    multi.del(sessionMetaKey(sessionId));
    multi.del(sessionPartsKey(sessionId));
    await multi.exec();
  });
}
async function runWithRedis<T>(fn: (client: any) => Promise<T>) {
  const { withRedis } = await import("@/lib/redis");
  return withRedis(fn);
}
