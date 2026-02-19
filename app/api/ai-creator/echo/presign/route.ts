import { extname } from "path";
import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { buildEchoSampleStorageKey } from "@/lib/ai/phase3";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { getUploadPresignedUrl } from "@/lib/storage";

export const runtime = "nodejs";

const PresignSchema = z.object({
  fileName: z.string().min(3).max(120).default("echo-sample.webm"),
  mimeType: z.string().min(5).max(120).default("audio/webm")
});

export async function POST(request: Request) {
  try {
    const { workspace } = await requireUserWithWorkspace();
    const body = PresignSchema.parse(await request.json());

    if (!body.mimeType.startsWith("audio/")) {
      throw new Error("Echo samples must be audio/* MIME types");
    }

    const extension = extname(body.fileName || "") || ".webm";
    const storageKey = buildEchoSampleStorageKey(workspace.id, extension);
    const uploadUrl = await getUploadPresignedUrl(storageKey, body.mimeType, 900);

    return jsonOk({
      storageKey,
      uploadUrl,
      expiresInSec: 900
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
