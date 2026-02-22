import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { evaluateWorkspaceCreditGuardrails } from "@/lib/billing/guardrails";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const PreflightSchema = z.object({
  workspaceId: z.string().optional(),
  feature: z.string().min(2).max(120),
  estimatedCredits: z.number().int().positive()
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const body = PreflightSchema.parse(await request.json());

    const workspaceId = body.workspaceId ?? workspace.id;
    if (workspaceId !== workspace.id) {
      const membership = await prisma.workspaceMember.findFirst({
        where: {
          workspaceId,
          userId: user.id
        },
        select: {
          id: true
        }
      });
      if (!membership) {
        return jsonError("Unauthorized", 401);
      }
    }

    const decision = await evaluateWorkspaceCreditGuardrails({
      workspaceId,
      feature: body.feature,
      estimatedCredits: body.estimatedCredits
    });

    return jsonOk({
      workspaceId,
      feature: body.feature,
      decision
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
