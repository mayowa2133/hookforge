import { listAutopilotSessions } from "@/lib/autopilot";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "30");
    return jsonOk(await listAutopilotSessions(params.id, limit));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
