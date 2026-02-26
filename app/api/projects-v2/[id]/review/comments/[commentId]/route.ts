import { z } from "zod";
import { updateProjectReviewCommentStatus } from "@/lib/review-phase5";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: {
    id: string;
    commentId: string;
  };
};

const UpdateCommentStatusSchema = z.object({
  shareToken: z.string().min(1).optional(),
  status: z.enum(["OPEN", "RESOLVED"])
});

export async function PATCH(request: Request, { params }: Context) {
  try {
    const body = UpdateCommentStatusSchema.parse(await request.json());
    const payload = await updateProjectReviewCommentStatus({
      projectIdOrV2Id: params.id,
      commentId: params.commentId,
      request,
      shareToken: body.shareToken,
      status: body.status
    });
    return jsonOk(payload);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
