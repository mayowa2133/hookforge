import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { listLedgerEntries } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const QuerySchema = z.object({
  workspaceId: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).default(50)
});

export async function GET(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      workspaceId: url.searchParams.get("workspaceId") ?? undefined,
      take: url.searchParams.get("take") ?? 50
    });

    const workspaceId = query.workspaceId ?? workspace.id;
    if (workspaceId !== workspace.id) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { workspaceId, userId: user.id },
        select: { id: true }
      });
      if (!membership) {
        throw new Error("Unauthorized");
      }
    }

    const entries = await listLedgerEntries(workspaceId, query.take);

    return jsonOk({
      workspaceId,
      entries
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
