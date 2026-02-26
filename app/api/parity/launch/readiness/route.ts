import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { buildDescriptPlusLaunchReadiness } from "@/lib/parity/launch-readiness";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { workspace, user } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    const readiness = await buildDescriptPlusLaunchReadiness({
      workspaceId: workspace.id,
      userEmail: user.email,
      persistIncident: true
    });
    return jsonOk(readiness);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
