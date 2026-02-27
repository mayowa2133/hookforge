import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getReleaseCandidateStatus } from "@/lib/parity/certification";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    return jsonOk(await getReleaseCandidateStatus(workspace.id));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
