import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { buildProjectStorageKey, getUploadPresignedUrl } from "@/lib/storage";
import { inferAssetKindFromMime, parseTemplateSlotSchema, validateAssetAgainstSlot } from "@/lib/template-runtime";
import { routeErrorToResponse } from "@/lib/http";

const PresignSchema = z.object({
  slotKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(3),
  sizeBytes: z.number().int().positive()
});

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = PresignSchema.parse(await request.json());
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (body.sizeBytes > maxBytes) {
      return NextResponse.json({ error: `File exceeds ${env.MAX_UPLOAD_MB}MB upload limit` }, { status: 413 });
    }

    const project = await prisma.project.findFirst({
      where: { id: params.id, userId: user.id },
      include: { template: true }
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const slotSchema = parseTemplateSlotSchema(project.template.slotSchema);
    const inferredKind = inferAssetKindFromMime(body.mimeType);

    validateAssetAgainstSlot(slotSchema, body.slotKey, inferredKind);

    const storageKey = buildProjectStorageKey(project.id, body.fileName);
    const uploadUrl = await getUploadPresignedUrl(storageKey, body.mimeType);

    return NextResponse.json({
      uploadUrl,
      storageKey,
      method: "PUT",
      headers: {
        "Content-Type": body.mimeType
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
