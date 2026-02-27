import { listProjectReviewAuditTrail } from "@/lib/review-phase5";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "100");
    return jsonOk(
      await listProjectReviewAuditTrail({
        projectIdOrV2Id: params.id,
        request,
        limit
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
