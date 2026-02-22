import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
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

    const [metrics, openBillingAnomaliesBySeverity] = await Promise.all([
      summarizeQualityMetrics(query.limit),
      prisma.usageAnomaly.groupBy({
        by: ["severity"],
        where: {
          status: {
            in: ["OPEN", "ACKNOWLEDGED"]
          },
          feature: {
            startsWith: "billing."
          }
        },
        _count: {
          _all: true
        }
      })
    ]);

    return jsonOk({
      ...metrics,
      billingAnomaliesBySeverity: openBillingAnomaliesBySeverity.map((item) => ({
        severity: item.severity,
        count: item._count._all
      }))
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
