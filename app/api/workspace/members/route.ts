import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { canManageWorkspaceMembers } from "@/lib/workspace-roles";

export const runtime = "nodejs";

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).default("EDITOR")
});

export async function GET() {
  try {
    const { workspace } = await requireUserWithWorkspace();
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
    const { user, workspace } = await requireUserWithWorkspace();
    const body = InviteSchema.parse(await request.json());

    const actorMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: user.id
        }
      }
    });

    if (!actorMembership || !canManageWorkspaceMembers(actorMembership.role)) {
      return jsonError("Only admins can add workspace members", 403);
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
