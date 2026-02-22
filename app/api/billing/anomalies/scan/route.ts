import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { scanUsageAnomaliesForWorkspace } from "@/lib/billing/anomalies";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { canManageWorkspaceMembers } from "@/lib/workspace-roles";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const ScanSchema = z.object({
  feature: z.string().min(2).max(120).optional()
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const body = ScanSchema.parse(await request.json().catch(() => ({})));

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: user.id
        }
      }
    });
    if (!membership || !canManageWorkspaceMembers(membership.role)) {
      return jsonError("Only admins can scan billing anomalies", 403);
    }

    const result = await scanUsageAnomaliesForWorkspace({
      workspaceId: workspace.id,
      featureFilter: body.feature
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "billing_anomaly_scan",
      targetType: "Workspace",
      targetId: workspace.id,
      details: {
        feature: body.feature ?? null,
        detected: result.detected.length
      }
    });

    return jsonOk({
      workspaceId: workspace.id,
      windowStart: result.windowStart,
      windowEnd: result.windowEnd,
      detected: result.detected
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
