import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { routeErrorToResponse } from "@/lib/http";
import {
  createResumableUploadSession,
  ResumableInitiateSchema,
  RESUMABLE_DEFAULT_PART_SIZE_BYTES,
  RESUMABLE_MIN_PART_SIZE_BYTES
} from "@/lib/mobile/resumable";
import { prisma } from "@/lib/prisma";
import { buildProjectStorageKey, createMultipartUpload } from "@/lib/storage";
import { inferAssetKindFromMime, parseTemplateSlotSchema, validateAssetAgainstSlot } from "@/lib/template-runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = ResumableInitiateSchema.parse(await request.json());

    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (body.sizeBytes > maxBytes) {
      return NextResponse.json({ error: `File exceeds ${env.MAX_UPLOAD_MB}MB upload limit` }, { status: 413 });
    }

    const project = await prisma.project.findFirst({
      where: {
        id: body.projectId,
        userId: user.id
      },
      include: {
        template: true
      }
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const slotSchema = parseTemplateSlotSchema(project.template.slotSchema);
    const inferredKind = inferAssetKindFromMime(body.mimeType);
    validateAssetAgainstSlot(slotSchema, body.slotKey, inferredKind);

    const storageKey = buildProjectStorageKey(body.projectId, body.fileName);
    const uploadId = await createMultipartUpload(storageKey, body.mimeType);

    const session = await createResumableUploadSession({
      userId: user.id,
      projectId: body.projectId,
      slotKey: body.slotKey,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      storageKey,
      uploadId,
      totalParts: body.totalParts,
      partSizeBytes: body.partSizeBytes
    });

    return NextResponse.json({
      session: {
        id: session.id,
        projectId: session.projectId,
        slotKey: session.slotKey,
        storageKey: session.storageKey,
        totalParts: session.totalParts,
        partSizeBytes: session.partSizeBytes,
        minPartSizeBytes: RESUMABLE_MIN_PART_SIZE_BYTES,
        recommendedPartSizeBytes: RESUMABLE_DEFAULT_PART_SIZE_BYTES,
        status: session.status
      },
      next: {
        getPartUrlEndpoint: `/api/mobile/uploads/resumable/${session.id}/part-url`,
        completePartEndpoint: `/api/mobile/uploads/resumable/${session.id}/part-complete`,
        statusEndpoint: `/api/mobile/uploads/resumable/${session.id}`,
        completeUploadEndpoint: `/api/mobile/uploads/resumable/${session.id}/complete`,
        abortEndpoint: `/api/mobile/uploads/resumable/${session.id}/abort`
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
