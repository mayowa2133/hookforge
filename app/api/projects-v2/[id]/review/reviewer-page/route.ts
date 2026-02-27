import { getProjectReviewerPage } from "@/lib/review-phase5";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    return jsonOk(
      await getProjectReviewerPage({
        projectIdOrV2Id: params.id,
        request
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
