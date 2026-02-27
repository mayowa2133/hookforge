import { createAutopilotPlan, AutopilotPlanSchema } from "@/lib/autopilot";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = AutopilotPlanSchema.parse(await request.json());
    const result = await createAutopilotPlan(params.id, body);
    return jsonOk(
      {
        ...result,
        surface: "underlord"
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

