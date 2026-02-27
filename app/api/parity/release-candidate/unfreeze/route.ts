import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import {
  ReleaseCandidateUnfreezeSchema,
  unfreezeReleaseCandidate
} from "@/lib/parity/certification";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { workspace, user } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    const body = ReleaseCandidateUnfreezeSchema.parse(await request.json().catch(() => ({})));
    return jsonOk(
      await unfreezeReleaseCandidate({
        workspaceId: workspace.id,
        userId: user.id,
        payload: body
      }),
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
