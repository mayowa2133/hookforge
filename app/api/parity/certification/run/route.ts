import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { buildPhase6CertificationReadout } from "@/lib/parity/certification";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { workspace, user } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    return jsonOk(
      await buildPhase6CertificationReadout({
        workspaceId: workspace.id,
        runByUserId: user.id,
        persistRun: true
      }),
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
