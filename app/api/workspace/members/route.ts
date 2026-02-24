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

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).default("EDITOR")
});

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "workspace.members.read",
      request
    });
    const members = await prisma.workspaceMember.findMany({
      where: {
        workspaceId: workspace.id
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            createdAt: true
          }
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return jsonOk({
      workspaceId: workspace.id,
      members: members.map((member) => ({
        id: member.id,
        userId: member.userId,
        email: member.user.email,
        role: member.role,
        createdAt: member.createdAt
      }))
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, workspace, membership: actorMembership } = await requireWorkspaceCapability({
      capability: "workspace.members.write",
      request
    });
    const body = InviteSchema.parse(await request.json());

    if (!actorMembership || !canManageWorkspaceMembers(actorMembership.role)) {
      return jsonError("Only admins can add workspace members", 403);
    }
    if (!canAssignWorkspaceRole(actorMembership.role, body.role)) {
      return jsonError("Your role cannot assign the requested workspace role", 403);
    }

    const targetUser = await prisma.user.findUnique({
      where: {
        email: body.email.toLowerCase().trim()
      },
      select: {
        id: true,
        email: true
      }
    });

    if (!targetUser) {
      return jsonError("User not found. Ask them to register first.", 404);
    }

    const existingMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: targetUser.id
        }
      }
    });

    if (existingMembership && !canManageTargetRole(actorMembership.role, existingMembership.role)) {
      return jsonError("Your role cannot modify this member", 403);
    }

    if (existingMembership && isManagerRole(existingMembership.role) && !isManagerRole(body.role)) {
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

    const member = await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: targetUser.id
        }
      },
      create: {
        workspaceId: workspace.id,
        userId: targetUser.id,
        role: body.role
      },
      update: {
        role: body.role
      }
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "workspace_member_upsert",
      targetType: "WorkspaceMember",
      targetId: member.id,
      details: {
        targetUserId: member.userId,
        role: member.role
      }
    });

    return jsonOk(
      {
        workspaceId: workspace.id,
        member: {
          id: member.id,
          userId: member.userId,
          email: targetUser.email,
          role: member.role
        }
      },
      201
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
