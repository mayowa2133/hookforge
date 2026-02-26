import { replayAutopilotSession, AutopilotReplaySchema } from "@/lib/autopilot";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = AutopilotReplaySchema.parse(await request.json());
    return jsonOk(
      await replayAutopilotSession({
        projectIdOrV2Id: params.id,
        sessionId: body.sessionId,
        applyImmediately: body.applyImmediately,
        reuseOperationDecisions: body.reuseOperationDecisions
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
