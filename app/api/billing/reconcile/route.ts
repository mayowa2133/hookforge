import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { reconcileWorkspaceBillingState } from "@/lib/billing/reconciliation";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const ReconcileSchema = z.object({
  repairWalletMismatch: z.boolean().default(false)
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "billing.manage",
      request
    });
    const body = ReconcileSchema.parse(await request.json().catch(() => ({})));

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
