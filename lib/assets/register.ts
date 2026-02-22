import { z } from "zod";
import { probeStorageAsset } from "@/lib/ffprobe";
import { prisma } from "@/lib/prisma";
import { getDownloadPresignedUrl } from "@/lib/storage";
import {
  inferAssetKindFromMime,
  parseTemplateSlotSchema,
  projectReadinessFromAssets,
  validateAssetAgainstSlot
} from "@/lib/template-runtime";
import { needsVideoNormalization, normalizeStorageVideoToMp4 } from "@/lib/video-normalize";

export const RegisterAssetInputSchema = z.object({
  slotKey: z.string().min(1),
  storageKey: z.string().min(1),
  mimeType: z.string().min(3)
});

export type RegisterAssetInput = z.infer<typeof RegisterAssetInputSchema>;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeStorageAssetWithRetry(storageKey: string, attempts = 4) {
  let lastError: unknown = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await probeStorageAsset(storageKey);
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await sleep(250 * (index + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not probe uploaded media");
}

export async function registerProjectAssetForUser(params: {
  userId: string;
  projectId: string;
  input: RegisterAssetInput;
}) {
  const project = await prisma.project.findFirst({
    where: { id: params.projectId, userId: params.userId },
    include: { template: true, assets: true }
  });

  if (!project) {
    throw new Error("Project not found");
  }

  const body = RegisterAssetInputSchema.parse(params.input);
  const slotSchema = parseTemplateSlotSchema(project.template.slotSchema);
  const kind = inferAssetKindFromMime(body.mimeType);

  let durationSec: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let finalStorageKey = body.storageKey;
  let finalMimeType = body.mimeType;

  if (kind === "VIDEO" || kind === "AUDIO") {
    const probe = await probeStorageAssetWithRetry(body.storageKey);
    durationSec = probe.durationSec;
    width = probe.width;
    height = probe.height;

    if (kind === "VIDEO" && needsVideoNormalization(body.mimeType, probe)) {
      const normalized = await normalizeStorageVideoToMp4({
        storageKey: body.storageKey,
        projectId: project.id,
        slotKey: body.slotKey
      });
      finalStorageKey = normalized.storageKey;
      finalMimeType = normalized.mimeType;
      durationSec = normalized.probe.durationSec;
      width = normalized.probe.width;
      height = normalized.probe.height;
    }
  }

  validateAssetAgainstSlot(slotSchema, body.slotKey, kind, durationSec, { enforceDuration: true });

  const asset = await prisma.asset.upsert({
    where: {
      projectId_slotKey: {
        projectId: project.id,
        slotKey: body.slotKey
      }
    },
    update: {
      kind,
      storageKey: finalStorageKey,
      mimeType: finalMimeType,
      durationSec,
      width,
      height
    },
    create: {
      projectId: project.id,
      slotKey: body.slotKey,
      kind,
      storageKey: finalStorageKey,
      mimeType: finalMimeType,
      durationSec,
      width,
      height
    }
  });

  const assets = await prisma.asset.findMany({
    where: { projectId: project.id },
    select: { slotKey: true }
  });

  const readiness = projectReadinessFromAssets(project.template, assets);

  const updatedProject = await prisma.project.update({
    where: { id: project.id },
    data: {
      status: readiness.ready ? "READY" : "DRAFT"
    },
    select: {
      id: true,
      status: true
    }
  });

  return {
    asset: {
      ...asset,
      signedUrl: await getDownloadPresignedUrl(asset.storageKey)
    },
    project: updatedProject,
    missingSlotKeys: readiness.missingSlotKeys
  };
}
