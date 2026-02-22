import { addLedgerEntry } from "@/lib/credits";

export async function recordWorkspaceAuditEvent(params: {
  workspaceId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
}) {
  return addLedgerEntry({
    workspaceId: params.workspaceId,
    amount: 0,
    entryType: "ADJUSTMENT",
    feature: `audit.${params.action}`,
    referenceType: params.targetType,
    referenceId: params.targetId,
    metadata: {
      actorUserId: params.actorUserId,
      ...(params.details ?? {})
    }
  });
}
