import { createReviewRequest, ReviewRequestCreateSchema } from "@/lib/review-requests";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = ReviewRequestCreateSchema.parse(await request.json());
    return jsonOk(
      await createReviewRequest({
        projectIdOrV2Id: params.id,
        title: body.title,
        note: body.note,
        requiredScopes: body.requiredScopes
      }),
      201
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
