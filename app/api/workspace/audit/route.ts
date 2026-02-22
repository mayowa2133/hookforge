import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const QuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(200).default(80)
});

export async function GET(request: Request) {
  try {
    const { workspace } = await requireUserWithWorkspace();
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      take: url.searchParams.get("take") ?? undefined
    });

    const auditEntries = await prisma.creditLedgerEntry.findMany({
      where: {
        workspaceId: workspace.id,
        feature: {
          startsWith: "audit."
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.take
    });

    return jsonOk({
      workspaceId: workspace.id,
      auditEntries
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
