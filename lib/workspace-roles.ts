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

export function isManagerRole(role: WorkspaceRole) {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageTargetRole(actorRole: WorkspaceRole, targetRole: WorkspaceRole) {
  if (actorRole === "OWNER") {
    return targetRole !== "OWNER";
  }
  if (actorRole === "ADMIN") {
    return targetRole === "EDITOR" || targetRole === "VIEWER";
  }
  return false;
}

export function canAssignWorkspaceRole(actorRole: WorkspaceRole, nextRole: WorkspaceRole) {
  if (actorRole === "OWNER") {
    return nextRole === "ADMIN" || nextRole === "EDITOR" || nextRole === "VIEWER";
  }
  if (actorRole === "ADMIN") {
    return nextRole === "EDITOR" || nextRole === "VIEWER";
  }
  return false;
}
