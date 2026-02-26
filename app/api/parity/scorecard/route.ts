import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { buildParityScorecardForWorkspace } from "@/lib/parity/scorecard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    return jsonOk(await buildParityScorecardForWorkspace(workspace.id));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
