import { z } from "zod";
import { submitProjectReviewDecision } from "@/lib/review-phase5";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const SubmitReviewDecisionSchema = z.object({
  shareToken: z.string().min(1).optional(),
  status: z.enum(["APPROVED", "REJECTED"]).default("APPROVED"),
  note: z.string().max(2000).optional(),
  requireApproval: z.boolean().optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = SubmitReviewDecisionSchema.parse(await request.json());
    const payload = await submitProjectReviewDecision({
      projectIdOrV2Id: params.id,
      request,
      shareToken: body.shareToken,
      status: body.status,
      note: body.note,
      requireApproval: body.requireApproval
    });
    return jsonOk(payload);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
