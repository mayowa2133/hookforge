import type { WorkspaceRole } from "@prisma/client";

const roleRank: Record<WorkspaceRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1
};

export function isAtLeastRole(currentRole: WorkspaceRole, requiredRole: WorkspaceRole) {
  return roleRank[currentRole] >= roleRank[requiredRole];
}

export function canManageWorkspaceMembers(role: WorkspaceRole) {
  return isAtLeastRole(role, "ADMIN");
}
