import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { probeStorageAsset } from "@/lib/ffprobe";
import { prisma } from "@/lib/prisma";
import { getDownloadPresignedUrl } from "@/lib/storage";
import {
  inferAssetKindFromMime,
  parseTemplateSlotSchema,
  projectReadinessFromAssets,
  validateAssetAgainstSlot
} from "@/lib/template-runtime";
import { routeErrorToResponse } from "@/lib/http";
import { needsVideoNormalization, normalizeStorageVideoToMp4 } from "@/lib/video-normalize";

const RegisterSchema = z.object({
  slotKey: z.string().min(1),
  storageKey: z.string().min(1),
  mimeType: z.string().min(3)
});

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

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

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = RegisterSchema.parse(await request.json());

    const project = await prisma.project.findFirst({
      where: { id: params.id, userId: user.id },
      include: { template: true, assets: true }
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

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

    return NextResponse.json({
      asset: {
        ...asset,
        signedUrl: await getDownloadPresignedUrl(asset.storageKey)
      },
      project: updatedProject,
      missingSlotKeys: readiness.missingSlotKeys
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
