import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getParityBenchmark } from "@/lib/parity/benchmarks";

export const runtime = "nodejs";

type Context = {
  params: { runId: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    return jsonOk(await getParityBenchmark(params.runId, workspace.id));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
