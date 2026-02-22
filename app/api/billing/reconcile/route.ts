import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { reconcileWorkspaceBillingState } from "@/lib/billing/reconciliation";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { canManageWorkspaceMembers } from "@/lib/workspace-roles";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const ReconcileSchema = z.object({
  repairWalletMismatch: z.boolean().default(false)
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const body = ReconcileSchema.parse(await request.json().catch(() => ({})));

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: user.id
        }
      }
    });
    if (!membership || !canManageWorkspaceMembers(membership.role)) {
      return jsonError("Only admins can reconcile billing", 403);
    }

    const summary = await reconcileWorkspaceBillingState({
      workspaceId: workspace.id,
      actorUserId: user.id,
      repairWalletMismatch: body.repairWalletMismatch
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "billing_reconcile",
      targetType: "Workspace",
      targetId: workspace.id,
      details: {
        repairWalletMismatch: body.repairWalletMismatch,
        mismatch: summary.integrity.mismatch,
        renewedSubscriptions: summary.lifecycle.renewedSubscriptions
      }
    });

    return jsonOk({
      workspaceId: workspace.id,
      summary
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
