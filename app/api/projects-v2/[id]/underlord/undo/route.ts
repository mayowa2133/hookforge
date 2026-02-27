import { undoAutopilotPlan, AutopilotUndoSchema } from "@/lib/autopilot";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = AutopilotUndoSchema.parse(await request.json());
    return jsonOk(
      await undoAutopilotPlan({
        projectIdOrV2Id: params.id,
        undoToken: body.undoToken,
        force: body.force,
        sessionId: body.sessionId
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

