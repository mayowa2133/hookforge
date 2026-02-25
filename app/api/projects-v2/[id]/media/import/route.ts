import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { routeErrorToResponse } from "@/lib/http";
import { requireProjectContext } from "@/lib/api-context";
import { buildProjectStorageKey, getUploadPresignedUrl } from "@/lib/storage";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const ImportSchema = z.object({
  fileName: z.string().min(1).max(220),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  slot: z.enum(["primary", "broll", "audio"]).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = ImportSchema.parse(await request.json());
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (body.sizeBytes > maxBytes) {
      return NextResponse.json({ error: `File exceeds ${env.MAX_UPLOAD_MB}MB upload limit` }, { status: 413 });
    }

    const ctx = await requireProjectContext(params.id);
    const storageKey = buildProjectStorageKey(ctx.projectV2.id, body.fileName);
    const uploadUrl = await getUploadPresignedUrl(storageKey, body.mimeType);

    return NextResponse.json({
      uploadUrl,
      storageKey,
      method: "PUT",
      headers: {
        "Content-Type": body.mimeType
      },
      assetIdDraft: `${ctx.projectV2.id}:${storageKey}`
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
