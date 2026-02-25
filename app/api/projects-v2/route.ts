import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { buildProjectsV2EntrypointPath, projectsV2FeatureFlags, resolveProjectsV2EditorShell, normalizeEditorCreationMode } from "@/lib/editor-cutover";
import { ensureSystemFreeformTemplate, isSystemTemplateSlug } from "@/lib/freeform";
import { routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { ensureProjectV2FromLegacy } from "@/lib/project-v2";
import { getDefaultConfigFromTemplate } from "@/lib/template-runtime";
import { ensurePersonalWorkspace } from "@/lib/workspaces";

export const runtime = "nodejs";

const CreateProjectV2Schema = z.object({
  mode: z.enum(["FREEFORM", "QUICK_START"]).optional(),
  templateId: z.string().optional(),
  templateSlug: z.string().optional(),
  presetId: z.string().optional(),
  title: z.string().min(2).max(120).optional()
});

function projectV2DisabledResponse() {
  return NextResponse.json({ error: "Projects v2 is disabled" }, { status: 404 });
}

function resolveTemplateQuery(body: z.infer<typeof CreateProjectV2Schema>) {
  const resolvedTemplateId = body.presetId ?? body.templateId;
  if (resolvedTemplateId) {
    return { id: resolvedTemplateId };
  }
  if (body.templateSlug) {
    return { slug: body.templateSlug };
  }
  return null;
}

export async function GET() {
  try {
    if (!projectsV2FeatureFlags.projectsV2Enabled) {
      return projectV2DisabledResponse();
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspace = await ensurePersonalWorkspace(user.id, user.email);
    const projectV2List = await prisma.projectV2.findMany({
      where: {
        workspaceId: workspace.id
      },
      include: {
        currentRevision: {
          select: {
            id: true,
            revisionNumber: true,
            timelineHash: true,
            createdAt: true
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 80
    });

    const legacyIds = projectV2List
      .map((project) => project.legacyProjectId)
      .filter((id): id is string => Boolean(id));

    const legacyProjects = legacyIds.length > 0
      ? await prisma.project.findMany({
          where: {
            id: { in: legacyIds }
          },
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
            template: {
              select: {
                id: true,
                slug: true,
                name: true
              }
            }
          }
        })
      : [];

    const legacyById = new Map(legacyProjects.map((project) => [project.id, project]));

    const projects = projectV2List.map((project) => {
      const legacy = project.legacyProjectId ? legacyById.get(project.legacyProjectId) : null;
      const editorShell = resolveProjectsV2EditorShell(user.email, projectsV2FeatureFlags);
      const creationMode = legacy?.template && isSystemTemplateSlug(legacy.template.slug) ? "FREEFORM" : "QUICK_START";
      return {
        id: project.id,
        title: project.title,
        status: project.status,
        creationMode,
        workspaceId: project.workspaceId,
        legacyProjectId: project.legacyProjectId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        currentRevision: project.currentRevision,
        editorShell,
        entrypointPath: buildProjectsV2EntrypointPath({
          projectV2Id: project.id,
          legacyProjectId: legacy?.id ?? null,
          userEmail: user.email,
          flags: projectsV2FeatureFlags
        }),
        legacy
      };
    });

    return NextResponse.json({ projects });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!projectsV2FeatureFlags.projectsV2Enabled) {
      return projectV2DisabledResponse();
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = CreateProjectV2Schema.parse(await request.json());
    const mode = normalizeEditorCreationMode(body.mode, projectsV2FeatureFlags.aiEditorDefault ? "FREEFORM" : "QUICK_START");

    const workspace = await ensurePersonalWorkspace(user.id, user.email);
    const templateQuery = resolveTemplateQuery(body);

    if (mode === "FREEFORM") {
      const freeformTemplate = await ensureSystemFreeformTemplate();

      const legacyProject = await prisma.project.create({
        data: {
          userId: user.id,
          workspaceId: workspace.id,
          templateId: freeformTemplate.id,
          title: body.title ?? "Untitled Freeform Project",
          status: "DRAFT",
          config: {}
        },
        select: {
          id: true,
          title: true,
          status: true
        }
      });

      const projectV2 = await ensureProjectV2FromLegacy({
        legacyProjectId: legacyProject.id,
        workspaceId: workspace.id,
        createdByUserId: user.id,
        title: legacyProject.title,
        status: legacyProject.status
      });

      return NextResponse.json({
        project: {
          id: projectV2.id,
          title: projectV2.title,
          status: projectV2.status,
          mode: "FREEFORM" as const,
          creationMode: "FREEFORM" as const,
          legacyProjectId: legacyProject.id,
          editorShell: resolveProjectsV2EditorShell(user.email, projectsV2FeatureFlags),
          entrypointPath: buildProjectsV2EntrypointPath({
            projectV2Id: projectV2.id,
            legacyProjectId: legacyProject.id,
            userEmail: user.email,
            flags: projectsV2FeatureFlags
          }),
          seededFromTemplate: null
        }
      }, { status: 201 });
    }

    if (mode === "QUICK_START" && !templateQuery) {
      return NextResponse.json({ error: "templateId, templateSlug, or presetId is required for quick start mode" }, { status: 400 });
    }

    const template = templateQuery
      ? await prisma.template.findFirst({
          where: templateQuery
        })
      : null;

    if (templateQuery && !template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const legacyProject = await prisma.project.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        templateId: template.id,
        title: body.title ?? `${template.name} Project`,
        status: "DRAFT",
        config: getDefaultConfigFromTemplate(template)
      },
      select: {
        id: true,
        title: true,
        status: true
      }
    });

    const projectV2 = await ensureProjectV2FromLegacy({
      legacyProjectId: legacyProject.id,
      workspaceId: workspace.id,
      createdByUserId: user.id,
      title: body.title ?? legacyProject.title,
      status: legacyProject.status
    });

    return NextResponse.json({
      project: {
        id: projectV2.id,
        title: projectV2.title,
        status: projectV2.status,
        mode,
        creationMode: "QUICK_START" as const,
        legacyProjectId: legacyProject.id,
        editorShell: resolveProjectsV2EditorShell(user.email, projectsV2FeatureFlags),
        entrypointPath: buildProjectsV2EntrypointPath({
          projectV2Id: projectV2.id,
          legacyProjectId: legacyProject.id,
          userEmail: user.email,
          flags: projectsV2FeatureFlags
        }),
        seededFromTemplate: {
          id: template.id,
          slug: template.slug,
          name: template.name
        }
      }
    }, { status: 201 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
