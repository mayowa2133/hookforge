import { getProjectReviewVersionCompare } from "@/lib/review-phase5";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const url = new URL(request.url);
    return jsonOk(
      await getProjectReviewVersionCompare({
        projectIdOrV2Id: params.id,
        request,
        baseRevisionId: url.searchParams.get("baseRevisionId"),
        targetRevisionId: url.searchParams.get("targetRevisionId")
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
