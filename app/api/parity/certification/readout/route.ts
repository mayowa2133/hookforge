import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { buildPhase6CertificationReadout } from "@/lib/parity/certification";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    return jsonOk(
      await buildPhase6CertificationReadout({
        workspaceId: workspace.id,
        persistRun: false
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
