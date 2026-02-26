import { applyAutopilotPlan, AutopilotApplySchema } from "@/lib/autopilot";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = AutopilotApplySchema.parse(await request.json());
    return jsonOk(
      await applyAutopilotPlan({
        projectIdOrV2Id: params.id,
        sessionId: body.sessionId,
        planRevisionHash: body.planRevisionHash,
        operationDecisions: body.operationDecisions
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
