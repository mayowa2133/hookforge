import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getQueueHealth } from "@/lib/ops";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    const health = await getQueueHealth();
    return jsonOk({
      workspaceId: workspace.id,
      ...health
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
