import { z } from "zod";
import { recommendProjectDesktopMediaRelink } from "@/lib/desktop/project-native";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = { params: { id: string } };

const MediaRelinkSchema = z.object({
  missingAssets: z.array(z.object({
    assetId: z.string().trim().min(1).max(120),
    originalFileName: z.string().trim().min(1).max(240),
    expectedDurationSec: z.number().min(0).max(24 * 60 * 60).optional(),
    expectedSizeBytes: z.number().int().min(0).optional()
  })).min(1).max(200),
  candidates: z.array(z.object({
    candidateId: z.string().trim().min(1).max(120).optional(),
    fileName: z.string().trim().min(1).max(240),
    absolutePath: z.string().trim().min(1).max(2048),
    durationSec: z.number().min(0).max(24 * 60 * 60).optional(),
    sizeBytes: z.number().int().min(0).optional()
  })).min(1).max(1000),
  apply: z.boolean().optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = MediaRelinkSchema.parse(await request.json());
    return jsonOk(
      await recommendProjectDesktopMediaRelink({
        projectIdOrV2Id: params.id,
        missingAssets: body.missingAssets,
        candidates: body.candidates,
        apply: body.apply
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
