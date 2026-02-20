import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { summarizeQualityMetrics } from "@/lib/quality/evals";

export const runtime = "nodejs";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(10).max(500).default(100)
});

export async function GET(request: Request) {
  try {
    await requireCurrentUser();
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined
    });

    const metrics = await summarizeQualityMetrics(query.limit);
    return jsonOk(metrics);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
