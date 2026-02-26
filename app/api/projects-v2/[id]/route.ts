import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildProjectsV2EntrypointPath, projectsV2FeatureFlags, resolveProjectsV2EditorShell } from "@/lib/editor-cutover";
import { isSystemTemplateSlug } from "@/lib/freeform";
import { routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

function projectV2DisabledResponse() {
  return NextResponse.json({ error: "Projects v2 is disabled" }, { status: 404 });
}

export async function GET(_request: Request, { params }: Context) {
  try {
    if (!projectsV2FeatureFlags.projectsV2Enabled) {
      return projectV2DisabledResponse();
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const project = await prisma.projectV2.findFirst({
      where: {
        id: params.id,
        workspace: {
          members: {
            some: {
              userId: user.id
            }
          }
        }
      },
      include: {
        currentRevision: true
      }
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const legacyProject = project.legacyProjectId
      ? await prisma.project.findFirst({
          where: {
            id: project.legacyProjectId,
            OR: [
              { userId: user.id },
              {
                workspace: {
                  members: {
                    some: {
                      userId: user.id
                    }
                  }
                }
              }
            ]
          },
          include: {
            template: {
              select: {
                id: true,
                slug: true,
                name: true
              }
            }
          }
        })
      : null;

    return NextResponse.json({
      project: {
        ...project,
        creationMode: legacyProject?.template?.slug && isSystemTemplateSlug(legacyProject.template.slug) ? "FREEFORM" : "QUICK_START",
        editorShell: resolveProjectsV2EditorShell(user.email, projectsV2FeatureFlags),
        entrypointPath: buildProjectsV2EntrypointPath({
          projectV2Id: project.id,
          legacyProjectId: legacyProject?.id ?? null,
          userEmail: user.email,
          flags: projectsV2FeatureFlags
        }),
        hasLegacyBridge: Boolean(legacyProject),
        supportsChatPlanApply: true,
        supportsChatSessions: true,
        supportsRevisionGraph: true,
        supportsFreeformRender: true,
        legacyProject
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
