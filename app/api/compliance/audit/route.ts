import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const QuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(200).default(50)
});

export async function GET(request: Request) {
  try {
    const { workspace } = await requireUserWithWorkspace();
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      take: url.searchParams.get("take") ?? "50"
    });

    const [rightsAttestations, sourceLinks, trustEvents] = await Promise.all([
      prisma.rightsAttestation.findMany({
        where: {
          workspaceId: workspace.id
        },
        orderBy: {
          createdAt: "desc"
        },
        take: query.take
      }),
      prisma.ingestionSourceLink.findMany({
        where: {
          mediaAsset: {
            workspaceId: workspace.id
          }
        },
        include: {
          mediaAsset: {
            select: {
              id: true,
              storageKey: true,
              mimeType: true,
              createdAt: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: query.take
      }),
      prisma.trustEvent.findMany({
        where: {
          workspaceId: workspace.id
        },
        orderBy: {
          createdAt: "desc"
        },
        take: query.take
      })
    ]);

    const breakdown = rightsAttestations.reduce<Record<string, number>>((acc, item) => {
      acc[item.sourceType] = (acc[item.sourceType] ?? 0) + 1;
      return acc;
    }, {});

    const takedownCount = trustEvents.filter((item) => item.eventType === "CONTENT_TAKEDOWN").length;
    const flaggedCount = trustEvents.filter((item) => item.eventType === "CONTENT_FLAGGED").length;

    return jsonOk({
      summary: {
        rightsAttestationCount: rightsAttestations.length,
        sourceLinkCount: sourceLinks.length,
        trustEventCount: trustEvents.length,
        takedownCount,
        flaggedCount,
        sourceTypeBreakdown: breakdown
      },
      rightsAttestations,
      sourceLinks,
      trustEvents
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
