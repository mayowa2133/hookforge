import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { listWorkspaceUsageAnomalies } from "@/lib/billing/anomalies";
import { routeErrorToResponse, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

const QuerySchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50)
});

export async function GET(request: Request) {
  try {
    const { workspace } = await requireUserWithWorkspace();
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      severity: url.searchParams.get("severity") ?? undefined,
      take: url.searchParams.get("take") ?? undefined
    });

    const anomalies = await listWorkspaceUsageAnomalies({
      workspaceId: workspace.id,
      status: query.status,
      severity: query.severity,
      take: query.take
    });

    return jsonOk({
      workspaceId: workspace.id,
      anomalies
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
