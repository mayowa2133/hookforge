import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { runParityBenchmark, RunParityBenchmarkSchema } from "@/lib/parity/benchmarks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = RunParityBenchmarkSchema.parse(await request.json().catch(() => ({})));
    const { workspace, user } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    return jsonOk(
      await runParityBenchmark({
        workspaceId: workspace.id,
        createdByUserId: user.id,
        modules: body.modules,
        passThreshold: body.passThreshold
      }),
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
