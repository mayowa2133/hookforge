import { z } from "zod";
import { getAudioSegmentAudition } from "@/lib/audio/phase3";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const SegmentABSchema = z.object({
  runId: z.string().min(1).optional(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
  language: z.string().trim().min(2).max(12).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = SegmentABSchema.parse(await request.json());
    return jsonOk(
      await getAudioSegmentAudition({
        projectIdOrV2Id: params.id,
        runId: body.runId,
        startMs: body.startMs,
        endMs: body.endMs,
        language: body.language
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
