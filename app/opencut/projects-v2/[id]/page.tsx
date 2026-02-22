import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { buildProjectsV2EntrypointPath, projectsV2FeatureFlags, resolveProjectsV2EditorShell } from "@/lib/editor-cutover";
import { prisma } from "@/lib/prisma";
import { OpenCutTranscriptShell } from "@/components/editor/opencut-transcript-shell";

type PageProps = {
  params: { id: string };
};

export default async function OpenCutProjectV2Page({ params }: PageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!projectsV2FeatureFlags.projectsV2Enabled || !projectsV2FeatureFlags.opencutEditorEnabled) {
    notFound();
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
    select: {
      id: true,
      title: true,
      status: true,
      legacyProjectId: true
    }
  });

  if (!project) {
    notFound();
  }

  const entrypointPath = buildProjectsV2EntrypointPath({
    projectV2Id: project.id,
    legacyProjectId: project.legacyProjectId,
    userEmail: user.email,
    flags: projectsV2FeatureFlags
  });

  if (entrypointPath !== `/opencut/projects-v2/${project.id}`) {
    redirect(entrypointPath);
  }

  if (!project.legacyProjectId) {
    return (
      <div className="space-y-5">
        <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
          OpenCut Shell
        </h1>
        <Card>
          <CardHeader>
            <CardTitle>{project.title}</CardTitle>
            <CardDescription>OpenCut transcript editor currently requires a Quick Start seeded legacy project.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            This project does not have a legacy bridge yet. Create a Quick Start template project and reopen it to use the OpenCut shell
            transcript editor path.
          </CardContent>
        </Card>
      </div>
    );
  }

  const editorShell = resolveProjectsV2EditorShell(user.email, projectsV2FeatureFlags);
  if (editorShell !== "OPENCUT") {
    redirect(`/projects/${project.legacyProjectId}`);
  }

  return (
    <OpenCutTranscriptShell
      projectV2Id={project.id}
      legacyProjectId={project.legacyProjectId}
      title={project.title}
      status={project.status}
    />
  );
}
