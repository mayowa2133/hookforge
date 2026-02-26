import { z } from "zod";
import { createProjectReviewComment, listProjectReviewComments } from "@/lib/review-phase5";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const CreateCommentSchema = z.object({
  shareToken: z.string().min(1).optional(),
  body: z.string().trim().min(1).max(2000),
  anchorMs: z.number().int().min(0).optional().nullable(),
  transcriptStartMs: z.number().int().min(0).optional().nullable(),
  transcriptEndMs: z.number().int().min(0).optional().nullable(),
  timelineTrackId: z.string().min(1).max(120).optional().nullable(),
  clipId: z.string().min(1).max(120).optional().nullable()
});

export async function GET(request: Request, { params }: Context) {
  try {
    const payload = await listProjectReviewComments({
      projectIdOrV2Id: params.id,
      request
    });
    return jsonOk(payload);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const body = CreateCommentSchema.parse(await request.json());
    const payload = await createProjectReviewComment({
      projectIdOrV2Id: params.id,
      request,
      shareToken: body.shareToken,
      body: body.body,
      anchorMs: body.anchorMs,
      transcriptStartMs: body.transcriptStartMs,
      transcriptEndMs: body.transcriptEndMs,
      timelineTrackId: body.timelineTrackId,
      clipId: body.clipId
    });
    return jsonOk(payload, 201);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
