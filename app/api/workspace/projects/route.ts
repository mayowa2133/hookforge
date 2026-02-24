import { requireUserWithWorkspace } from "@/lib/api-context";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: user.id
        }
      }
    });

    if (!membership) {
      throw new Error("Unauthorized");
    }

    const projects = await prisma.project.findMany({
      where: {
        workspaceId: workspace.id
      },
      include: {
        template: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            id: true,
            email: true
          }
        },
        renderJobs: {
          orderBy: {
            createdAt: "desc"
          },
          take: 1
        }
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 50
    });

    return jsonOk({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      projects: projects.map((project) => ({
        id: project.id,
        title: project.title,
        status: project.status,
        template: project.template,
        owner: project.user,
        updatedAt: project.updatedAt,
        latestRender: project.renderJobs[0]
          ? {
              id: project.renderJobs[0].id,
              status: project.renderJobs[0].status,
              progress: project.renderJobs[0].progress
            }
          : null
      }))
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
