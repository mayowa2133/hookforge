import { Prisma, TrustSeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type WorkspaceAuditParams = {
  workspaceId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId?: string;
  severity?: TrustSeverity;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
};

export function buildWorkspaceAuditEventInput(params: WorkspaceAuditParams) {
  return {
    workspaceId: params.workspaceId,
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    severity: params.severity ?? "INFO",
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: params.details as Prisma.InputJsonValue | undefined
  };
}

export async function recordWorkspaceAuditEvent(params: WorkspaceAuditParams) {
  return prisma.auditEvent.create({
    data: buildWorkspaceAuditEventInput(params)
  });
}
