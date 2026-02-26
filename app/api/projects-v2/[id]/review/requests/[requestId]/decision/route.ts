import { decideReviewRequest, ReviewRequestDecisionSchema } from "@/lib/review-requests";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string; requestId: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = ReviewRequestDecisionSchema.parse(await request.json());
    return jsonOk(
      await decideReviewRequest({
        projectIdOrV2Id: params.id,
        requestId: params.requestId,
        status: body.status,
        note: body.note,
        requireApproval: body.requireApproval
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
