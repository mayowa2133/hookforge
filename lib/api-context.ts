import { getCurrentUser } from "./auth";
import { requireOwnedProject } from "./projects";
import { resolveLegacyProjectIdForUser } from "./project-id-bridge";
import { ensurePersonalWorkspace } from "./workspaces";
import { ensureProjectV2FromLegacy } from "./project-v2";
import { prisma } from "./prisma";

export async function requireUserWithWorkspace() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }

  const workspace = await ensurePersonalWorkspace(user.id, user.email);

  return { user, workspace };
}

export async function requireProjectContext(projectId: string) {
  const { user, workspace } = await requireUserWithWorkspace();
  const resolvedLegacyProjectId = await resolveLegacyProjectIdForUser({
    projectIdOrV2Id: projectId,
    userId: user.id
  });

  if (!resolvedLegacyProjectId) {
    throw new Error("Project not found");
  }

  const legacyProject = await requireOwnedProject(resolvedLegacyProjectId, user.id);

  if (!legacyProject.workspaceId) {
    await prisma.project.update({
      where: { id: legacyProject.id },
      data: { workspaceId: workspace.id }
    });
  }

  const projectV2 = await ensureProjectV2FromLegacy({
    legacyProjectId: legacyProject.id,
    workspaceId: workspace.id,
    createdByUserId: user.id,
    title: legacyProject.title,
    status: legacyProject.status
  });

  return {
    user,
    workspace,
    legacyProject,
    projectV2
  };
}
