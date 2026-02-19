import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { basename, extname, join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { env } from "./env";

export const s3Client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY
  }
});

export const BUCKET = env.S3_BUCKET;

function sanitizeFilename(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

export function buildProjectStorageKey(projectId: string, fileName: string) {
  const safeName = sanitizeFilename(fileName || "asset");
  return `projects/${projectId}/${randomUUID()}-${safeName}`;
}

export function buildRenderOutputKey(projectId: string) {
  return `renders/${projectId}/${randomUUID()}.mp4`;
}

export async function getUploadPresignedUrl(storageKey: string, mimeType: string, expiresInSec = 900) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ContentType: mimeType
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: expiresInSec });
  return uploadUrl;
}

export async function getDownloadPresignedUrl(storageKey: string, expiresInSec = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSec });
}

export async function uploadBufferToStorage(storageKey: string, body: Buffer, options?: Partial<PutObjectCommandInput>) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    Body: body,
    ContentType: options?.ContentType ?? "application/octet-stream",
    ACL: options?.ACL
  });
  await s3Client.send(command);
}

export async function uploadFileToStorage(storageKey: string, filePath: string, contentType = "application/octet-stream") {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: storageKey,
    Body: createReadStream(filePath),
    ContentType: contentType
  });
  await s3Client.send(command);
}

export async function downloadStorageObjectToTempFile(storageKey: string, suffix?: string) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: storageKey
  });
  const response = await s3Client.send(command);
  const body = response.Body;

  if (!body) {
    throw new Error("Could not read object body stream");
  }

  const dir = join(tmpdir(), "hookforge-assets");
  await mkdir(dir, { recursive: true });

  const ext = suffix ? extname(suffix) : extname(basename(storageKey));
  const path = join(dir, `${randomUUID()}${ext || ""}`);

  if (body instanceof Readable) {
    const writeStream = createWriteStream(path);
    await pipeline(body, writeStream);
  } else if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    await writeFile(path, Buffer.from(bytes));
  } else if (Symbol.asyncIterator in (body as object)) {
    const stream = Readable.from(body as unknown as AsyncIterable<Uint8Array>);
    const writeStream = createWriteStream(path);
    await pipeline(stream, writeStream);
  } else {
    throw new Error("Unsupported object body stream type");
  }

  return {
    path,
    cleanup: async () => {
      try {
        await unlink(path);
      } catch {
        // ignore cleanup errors
      }
    }
  };
}
