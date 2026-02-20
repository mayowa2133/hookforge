import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { canManageWorkspaceMembers } from "@/lib/workspace-roles";

export const runtime = "nodejs";

type Context = {
  params: {
    memberId: string;
  };
};

const UpdateSchema = z.object({
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"])
});

async function requireManager(workspaceId: string, userId: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId
      }
    }
  });
  if (!membership || !canManageWorkspaceMembers(membership.role)) {
    throw new Error("Unauthorized");
  }
  return membership;
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    await requireManager(workspace.id, user.id);
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

    const updated = await prisma.workspaceMember.update({
      where: {
        id: member.id
      },
      data: {
        role: body.role
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

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    await requireManager(workspace.id, user.id);

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

    await prisma.workspaceMember.delete({
      where: {
        id: member.id
      }
    });

    return jsonOk({
      removedMemberId: member.id
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
