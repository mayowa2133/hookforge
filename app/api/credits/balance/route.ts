import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { getCreditBalance } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const QuerySchema = z.object({
  workspaceId: z.string().optional()
});

export async function GET(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const url = new URL(request.url);
    const query = QuerySchema.parse({ workspaceId: url.searchParams.get("workspaceId") ?? undefined });

    const workspaceId = query.workspaceId ?? workspace.id;
    if (workspaceId !== workspace.id) {
      const membership = await prisma.workspaceMember.findFirst({
        where: {
          workspaceId,
          userId: user.id
        },
        select: { id: true }
      });
      if (!membership) {
        throw new Error("Unauthorized");
      }
    }

    const balance = await getCreditBalance(workspaceId);

    const activePlan = await prisma.plan.findFirst({
      where: { workspaceId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" }
    });

    return jsonOk({
      workspaceId,
      availableCredits: balance,
      plan: activePlan
        ? {
            id: activePlan.id,
            name: activePlan.name,
            tier: activePlan.tier,
            monthlyCredits: activePlan.monthlyCredits,
            status: activePlan.status
          }
        : null
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
