import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getSloSummary } from "@/lib/ops";

export const runtime = "nodejs";

const QuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(24)
});

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "ops.read",
      request
    });
    const query = QuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    const summary = await getSloSummary({
      workspaceId: workspace.id,
      windowHours: query.windowHours
    });

    return jsonOk({
      workspaceId: workspace.id,
      summary
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
