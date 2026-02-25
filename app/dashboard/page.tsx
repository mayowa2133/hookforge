import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateAiProjectButton } from "@/components/dashboard/create-ai-project-button";
import { CreateProjectButton } from "@/components/dashboard/create-project-button";
import { ReferenceAnalyzer } from "@/components/dashboard/reference-analyzer";
import { getCurrentUser } from "@/lib/auth";
import { buildProjectsV2EntrypointPath, projectsV2FeatureFlags, resolveProjectsV2EditorShell } from "@/lib/editor-cutover";
import { SYSTEM_FREEFORM_TEMPLATE_SLUG } from "@/lib/freeform";
import { prisma } from "@/lib/prisma";
import { parseTemplateSlotSchema } from "@/lib/template-runtime";
import { ensurePersonalWorkspace } from "@/lib/workspaces";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const workspace = await ensurePersonalWorkspace(user.id, user.email);
  const [templates, projects, projectsV2Raw] = await Promise.all([
    prisma.template.findMany({
      where: {
        slug: {
          not: SYSTEM_FREEFORM_TEMPLATE_SLUG
        }
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.project.findMany({
      where: { userId: user.id },
      include: {
        template: true,
        renderJobs: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: { updatedAt: "desc" }
    }),
    projectsV2FeatureFlags.projectsV2Enabled
      ? prisma.projectV2.findMany({
          where: { workspaceId: workspace.id },
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
          orderBy: { updatedAt: "desc" },
          take: 40
        })
      : Promise.resolve([])
  ]);

  const legacyIds = projectsV2Raw
    .map((projectV2) => projectV2.legacyProjectId)
    .filter((id): id is string => Boolean(id));

  const legacyProjects = legacyIds.length > 0
    ? await prisma.project.findMany({
        where: {
          id: { in: legacyIds }
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
    : [];

  const legacyById = new Map(legacyProjects.map((project) => [project.id, project]));

  const projectsV2 = projectsV2Raw.map((projectV2) => {
    const legacy = projectV2.legacyProjectId ? legacyById.get(projectV2.legacyProjectId) ?? null : null;
    const editorShell = resolveProjectsV2EditorShell(user.email, projectsV2FeatureFlags);
    return {
      id: projectV2.id,
      title: projectV2.title,
      status: projectV2.status,
      updatedAt: projectV2.updatedAt,
      currentRevision: projectV2.currentRevision,
      editorShell,
      legacyTemplateName: legacy?.template?.name ?? null,
      entrypointPath: buildProjectsV2EntrypointPath({
        projectV2Id: projectV2.id,
        legacyProjectId: legacy?.id ?? null,
        userEmail: user.email,
        flags: projectsV2FeatureFlags
      })
    };
  });

  const quickStartTemplates = templates.slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">AI editor first with quick-start templates when you want a head start.</p>
        <div className="flex flex-wrap gap-2">
          {projectsV2FeatureFlags.projectsV2Enabled ? <CreateAiProjectButton /> : null}
          {projectsV2FeatureFlags.quickStartVisible ? (
            <Link href="/templates" className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
              Open Quick Start
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Need script-to-video, teleprompter, or camera capture?{" "}
          <Link href="/creator" className="underline">
            Open Creator Studio
          </Link>
          . Need ads, shorts, Reddit workflows, and compliance controls?{" "}
          <Link href="/growth" className="underline">
            Open Growth Lab
          </Link>
          . Need dubbing/lipdub and public API controls?{" "}
          <Link href="/localization" className="underline">
            Open Localization Lab
          </Link>
          . Need workspace billing, mobile rollout, and collaboration controls?{" "}
          <Link href="/launch" className="underline">
            Open Launch Console
          </Link>
          .
        </p>
      </div>

      <ReferenceAnalyzer />

      {projectsV2FeatureFlags.projectsV2Enabled ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">AI Editor Projects</h2>
            <p className="text-xs text-muted-foreground">
              Projects-v2 namespace with legacy bridge. OpenCut flag:{" "}
              {projectsV2FeatureFlags.opencutEditorEnabled ? "ON" : "OFF"} ({projectsV2FeatureFlags.opencutEditorCohort})
            </p>
          </div>
          {projectsV2.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                No AI editor projects yet. Create one above to start in the new namespace.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {projectsV2.map((project) => (
                <Card key={project.id}>
                  <CardHeader>
                    <CardTitle className="text-lg">{project.title}</CardTitle>
                    <CardDescription>
                      {project.legacyTemplateName ? `Seeded from ${project.legacyTemplateName}` : "Unseeded AI editor project"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span>Status</span>
                      <Badge>{project.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Revision {project.currentRevision?.revisionNumber ?? 0} • Updated {project.updatedAt.toLocaleString()} •
                      Shell {project.editorShell}
                    </p>
                    <Link
                      href={project.entrypointPath}
                      className="block rounded-md border px-3 py-2 text-center text-sm font-medium hover:bg-accent"
                    >
                      Open AI editor
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {projectsV2FeatureFlags.quickStartVisible ? (
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Quick Start Templates</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {quickStartTemplates.map((template) => {
            const schema = parseTemplateSlotSchema(template.slotSchema);
            return (
              <Card key={template.id}>
                <CardHeader>
                  <CardTitle>{template.name}</CardTitle>
                  <CardDescription>{template.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <img src={schema.previewImage} alt={template.name} className="h-36 w-full rounded-md object-cover" />
                  <div>
                    <p className="text-xs uppercase text-muted-foreground">Required inputs</p>
                    <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                      {schema.slots
                        .filter((slot) => slot.required)
                        .map((slot) => (
                          <li key={slot.key}>{slot.label}</li>
                        ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {template.tags.map((tag) => (
                      <Badge variant="secondary" key={tag}>{tag}</Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <CreateProjectButton templateId={template.id} className="flex-1" label="Use quick start" />
                    <Link className="flex-1 rounded-md border px-3 py-2 text-center text-sm font-medium hover:bg-accent" href={`/templates/${template.slug}`}>
                      Details
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <div>
          <Link href="/templates" className="text-sm font-medium underline">
            Browse all templates
          </Link>
        </div>
      </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-xl font-bold">Legacy projects</h2>
        {projects.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No legacy projects yet. Use Quick Start templates to create one.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Card key={project.id}>
                <CardHeader>
                  <CardTitle className="text-lg">{project.title}</CardTitle>
                  <CardDescription>{project.template.name}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span>Status</span>
                    <Badge>{project.status}</Badge>
                  </div>
                  {project.renderJobs[0] ? (
                    <p className="text-xs text-muted-foreground">
                      Last render: {project.renderJobs[0].status} ({project.renderJobs[0].progress}%)
                    </p>
                  ) : null}
                  <Link
                    href={`/projects/${project.id}`}
                    className="block rounded-md border px-3 py-2 text-center text-sm font-medium hover:bg-accent"
                  >
                    Open editor
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
