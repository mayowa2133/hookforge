import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  canAssignWorkspaceRole,
  canManageTargetRole,
  canManageWorkspaceMembers,
  isManagerRole
} from "@/lib/workspace-roles";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

type Context = {
  params: {
    memberId: string;
  };
};

const UpdateSchema = z.object({
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"])
});

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { user, workspace, membership } = await requireWorkspaceCapability({
      capability: "workspace.members.write",
      request
    });
    if (!canManageWorkspaceMembers(membership.role)) {
      return jsonError("Only admins can update workspace members", 403);
    }
    const body = UpdateSchema.parse(await request.json());

    const member = await prisma.workspaceMember.findFirst({
      where: {
        id: params.memberId,
        workspaceId: workspace.id
      }
    });

    if (!member) {
      return jsonError("Member not found", 404);
    }
    if (member.role === "OWNER") {
      return jsonError("Owner role cannot be reassigned", 400);
    }
    if (!canManageTargetRole(membership.role, member.role)) {
      return jsonError("Your role cannot modify this member", 403);
    }
    if (!canAssignWorkspaceRole(membership.role, body.role)) {
      return jsonError("Your role cannot assign the requested role", 403);
    }
    if (isManagerRole(member.role) && !isManagerRole(body.role)) {
      const managerCount = await prisma.workspaceMember.count({
        where: {
          workspaceId: workspace.id,
          role: {
            in: ["OWNER", "ADMIN"]
          }
        }
      });
      if (managerCount <= 1) {
        return jsonError("Workspace must retain at least one manager role", 400);
      }
    }

    const updated = await prisma.workspaceMember.update({
      where: {
        id: member.id
      },
      data: {
        role: body.role
      }
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "workspace_member_role_update",
      targetType: "WorkspaceMember",
      targetId: updated.id,
      details: {
        targetUserId: updated.userId,
        role: updated.role
      }
    });

    return jsonOk({
      member: {
        id: updated.id,
        userId: updated.userId,
        role: updated.role
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { user, workspace, membership } = await requireWorkspaceCapability({
      capability: "workspace.members.write",
      request
    });
    if (!canManageWorkspaceMembers(membership.role)) {
      return jsonError("Only admins can remove workspace members", 403);
    }

    const member = await prisma.workspaceMember.findFirst({
      where: {
        id: params.memberId,
        workspaceId: workspace.id
      }
    });

    if (!member) {
      return jsonError("Member not found", 404);
    }
    if (member.role === "OWNER") {
      return jsonError("Owner cannot be removed", 400);
    }
    if (!canManageTargetRole(membership.role, member.role)) {
      return jsonError("Your role cannot remove this member", 403);
    }
    if (isManagerRole(member.role)) {
      const managerCount = await prisma.workspaceMember.count({
        where: {
          workspaceId: workspace.id,
          role: {
            in: ["OWNER", "ADMIN"]
          }
        }
      });
      if (managerCount <= 1) {
        return jsonError("Workspace must retain at least one manager role", 400);
      }
    }

    await prisma.workspaceMember.delete({
      where: {
        id: member.id
      }
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "workspace_member_remove",
      targetType: "WorkspaceMember",
      targetId: member.id,
      details: {
        targetUserId: member.userId
      }
    });

    return jsonOk({
      removedMemberId: member.id
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
