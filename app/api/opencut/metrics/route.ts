import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import {
  normalizeOpenCutEventName,
  summarizeOpenCutMetrics,
  type OpenCutEventName,
  type OpenCutEventOutcome
} from "@/lib/opencut/metrics";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const QuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(24),
  limit: z.coerce.number().int().min(50).max(2000).default(500)
});

export async function GET(request: Request) {
  try {
    const { workspace } = await requireUserWithWorkspace();
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      windowHours: url.searchParams.get("windowHours") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined
    });

    const windowStart = new Date(Date.now() - query.windowHours * 60 * 60 * 1000);
    const rows = await prisma.qualityFeedback.findMany({
      where: {
        workspaceId: workspace.id,
        category: {
          startsWith: "opencut."
        },
        createdAt: {
          gte: windowStart
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.limit,
      select: {
        category: true,
        comment: true,
        metadata: true,
        createdAt: true
      }
    });

    const events: Array<{ event: OpenCutEventName; outcome: OpenCutEventOutcome; createdAt: Date }> = [];
    for (const row of rows) {
      const eventNameRaw = row.category.replace("opencut.", "");
      const event = normalizeOpenCutEventName(eventNameRaw);
      if (!event) {
        continue;
      }

      const metadataOutcome =
        row.metadata && typeof row.metadata === "object" && row.metadata !== null && "outcome" in row.metadata
          ? row.metadata.outcome
          : undefined;
      const outcomeRaw =
        typeof metadataOutcome === "string"
          ? metadataOutcome
          : typeof row.comment === "string"
            ? row.comment
            : "INFO";
      const outcome: OpenCutEventOutcome = outcomeRaw === "SUCCESS" || outcomeRaw === "ERROR" ? outcomeRaw : "INFO";

      events.push({
        event,
        outcome,
        createdAt: row.createdAt
      });
    }

    const summary = summarizeOpenCutMetrics({
      windowHours: query.windowHours,
      events
    });

    return jsonOk(summary);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
