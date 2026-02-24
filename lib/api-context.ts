import { getCurrentUser } from "./auth";
import { requireOwnedProject } from "./projects";
import { resolveLegacyProjectIdForUser } from "./project-id-bridge";
import { ensurePersonalWorkspace } from "./workspaces";
import { ensureProjectV2FromLegacy } from "./project-v2";
import { prisma } from "./prisma";
import { hasWorkspaceCapability, type WorkspaceCapability } from "./workspace-roles";

export async function requireUserWithWorkspace() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }

  const workspace = await ensurePersonalWorkspace(user.id, user.email);

  return { user, workspace };
}

async function findWorkspaceMembership(params: { workspaceId: string; userId: string }) {
  return prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: params.workspaceId,
        userId: params.userId
      }
    }
  });
}

export async function requireWorkspaceCapability(params: {
  capability: WorkspaceCapability;
  workspaceId?: string;
  request?: Request;
}) {
  const { user } = await requireUserWithWorkspace();
  const requestWorkspaceId =
    params.request?.headers.get("x-workspace-id")?.trim() ||
    (() => {
      try {
        return params.request ? new URL(params.request.url).searchParams.get("workspaceId")?.trim() : undefined;
      } catch {
        return undefined;
      }
    })();
  const effectiveWorkspaceId = params.workspaceId || requestWorkspaceId;
  const workspace = params.workspaceId
    ? await prisma.workspace.findFirst({
        where: {
          id: effectiveWorkspaceId,
          members: {
            some: {
              userId: user.id
            }
          }
        }
      })
    : effectiveWorkspaceId
      ? await prisma.workspace.findFirst({
          where: {
            id: effectiveWorkspaceId,
            members: {
              some: {
                userId: user.id
              }
            }
          }
        })
    : await ensurePersonalWorkspace(user.id, user.email);

  if (!workspace) {
    throw new Error("Workspace not found");
  }

  const membership = await findWorkspaceMembership({
    workspaceId: workspace.id,
    userId: user.id
  });

  if (!membership || !hasWorkspaceCapability(membership.role, params.capability)) {
    throw new Error("Unauthorized");
  }

  return {
    user,
    workspace,
    membership
  };
}

export async function requireProjectContext(projectId: string) {
  const { user, workspace } = await requireWorkspaceCapability({
    capability: "workspace.projects.read"
  });
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
