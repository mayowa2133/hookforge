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

export type WorkspaceCapability =
  | "workspace.members.read"
  | "workspace.members.write"
  | "workspace.security.read"
  | "workspace.security.write"
  | "workspace.audit.read"
  | "workspace.projects.read"
  | "workspace.projects.write"
  | "translation_profiles.read"
  | "translation_profiles.write"
  | "billing.read"
  | "billing.manage"
  | "api_keys.read"
  | "api_keys.manage"
  | "ops.read";

const capabilitiesByRole: Record<WorkspaceRole, ReadonlyArray<WorkspaceCapability>> = {
  OWNER: [
    "workspace.members.read",
    "workspace.members.write",
    "workspace.security.read",
    "workspace.security.write",
    "workspace.audit.read",
    "workspace.projects.read",
    "workspace.projects.write",
    "translation_profiles.read",
    "translation_profiles.write",
    "billing.read",
    "billing.manage",
    "api_keys.read",
    "api_keys.manage",
    "ops.read"
  ],
  ADMIN: [
    "workspace.members.read",
    "workspace.members.write",
    "workspace.security.read",
    "workspace.audit.read",
    "workspace.projects.read",
    "workspace.projects.write",
    "translation_profiles.read",
    "translation_profiles.write",
    "billing.read",
    "billing.manage",
    "api_keys.read",
    "api_keys.manage",
    "ops.read"
  ],
  EDITOR: [
    "workspace.members.read",
    "workspace.security.read",
    "workspace.projects.read",
    "workspace.projects.write",
    "translation_profiles.read",
    "translation_profiles.write",
    "billing.read",
    "api_keys.read"
  ],
  VIEWER: ["workspace.projects.read", "billing.read", "workspace.security.read", "workspace.members.read"]
};

export function hasWorkspaceCapability(role: WorkspaceRole, capability: WorkspaceCapability) {
  return capabilitiesByRole[role].includes(capability);
}
