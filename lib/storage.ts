import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
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
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
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

export async function createMultipartUpload(storageKey: string, mimeType: string) {
  const command = new CreateMultipartUploadCommand({
    Bucket: BUCKET,
    Key: storageKey,
    ContentType: mimeType
  });
  const response = await s3Client.send(command);
  if (!response.UploadId) {
    throw new Error("Could not create multipart upload");
  }
  return response.UploadId;
}

export async function getMultipartPartPresignedUrl(params: {
  storageKey: string;
  uploadId: string;
  partNumber: number;
  expiresInSec?: number;
}) {
  const command = new UploadPartCommand({
    Bucket: BUCKET,
    Key: params.storageKey,
    UploadId: params.uploadId,
    PartNumber: params.partNumber
  });
  return getSignedUrl(s3Client, command, { expiresIn: params.expiresInSec ?? 900 });
}

export type CompletedMultipartPart = {
  partNumber: number;
  eTag: string;
};

export async function completeMultipartUpload(params: {
  storageKey: string;
  uploadId: string;
  parts: CompletedMultipartPart[];
}) {
  if (params.parts.length === 0) {
    throw new Error("Multipart upload has no parts to complete");
  }

  const sortedParts = [...params.parts].sort((a, b) => a.partNumber - b.partNumber);
  const command = new CompleteMultipartUploadCommand({
    Bucket: BUCKET,
    Key: params.storageKey,
    UploadId: params.uploadId,
    MultipartUpload: {
      Parts: sortedParts.map((part) => ({
        PartNumber: part.partNumber,
        ETag: part.eTag
      }))
    }
  });
  await s3Client.send(command);
}

export async function abortMultipartUpload(params: { storageKey: string; uploadId: string }) {
  const command = new AbortMultipartUploadCommand({
    Bucket: BUCKET,
    Key: params.storageKey,
    UploadId: params.uploadId
  });
  await s3Client.send(command);
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

export async function copyStorageObject(params: {
  sourceKey: string;
  destinationKey: string;
  contentType?: string;
}) {
  const command = new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `${BUCKET}/${params.sourceKey}`,
    Key: params.destinationKey,
    ContentType: params.contentType,
    MetadataDirective: params.contentType ? "REPLACE" : "COPY"
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
