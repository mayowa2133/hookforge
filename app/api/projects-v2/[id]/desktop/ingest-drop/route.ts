import { z } from "zod";
import { planProjectDesktopDropIngest } from "@/lib/desktop/project-native";
import { env } from "@/lib/env";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = { params: { id: string } };

const IngestDropSchema = z.object({
  files: z.array(z.object({
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.string().trim().min(1).max(120),
    sizeBytes: z.number().int().min(0),
    durationSec: z.number().min(0).max(24 * 60 * 60).optional(),
    sourcePath: z.string().trim().max(1024).optional()
  })).min(1).max(50)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = IngestDropSchema.parse(await request.json());
    const payload = await planProjectDesktopDropIngest({
      projectIdOrV2Id: params.id,
      files: body.files,
      maxUploadMb: env.MAX_UPLOAD_MB
    });
    return jsonOk(payload, 202);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
