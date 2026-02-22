import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { buildProjectsV2EntrypointPath, projectsV2FeatureFlags, resolveProjectsV2EditorShell } from "@/lib/editor-cutover";
import { prisma } from "@/lib/prisma";

type PageProps = {
  params: { id: string };
};

export default async function ProjectV2Page({ params }: PageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!projectsV2FeatureFlags.projectsV2Enabled) {
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
    }
  });

  if (!project) {
    notFound();
  }

  const editorShell = resolveProjectsV2EditorShell(user.email, projectsV2FeatureFlags);
  const entrypointPath = buildProjectsV2EntrypointPath({
    projectV2Id: project.id,
    legacyProjectId: project.legacyProjectId,
    userEmail: user.email,
    flags: projectsV2FeatureFlags
  });

  if (entrypointPath !== `/projects-v2/${project.id}`) {
    redirect(entrypointPath);
  }

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
        AI Editor Project
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>{project.title}</CardTitle>
          <CardDescription>
            This project was created in AI-editor mode without a legacy template seed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Active editor shell: <span className="font-semibold text-foreground">{editorShell}</span> (cohort:{" "}
            <span className="font-semibold text-foreground">{projectsV2FeatureFlags.opencutEditorCohort}</span>)
          </p>
          <p>
            The full freeform timeline UI will land in the next slice. For now, use Quick Start templates to jump directly into the
            current editor stack.
          </p>
          <Link href="/templates" className="inline-block rounded-md border px-3 py-2 font-medium text-foreground hover:bg-accent">
            Open Quick Start Templates
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
