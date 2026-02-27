import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import {
  DescriptDiffRecordSchema,
  getLatestDescriptDiffStatus,
  recordDescriptDiff
} from "@/lib/parity/certification";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    return jsonOk(await getLatestDescriptDiffStatus(workspace.id));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { workspace, user } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    const body = DescriptDiffRecordSchema.parse(await request.json().catch(() => ({})));
    return jsonOk(
      await recordDescriptDiff({
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
