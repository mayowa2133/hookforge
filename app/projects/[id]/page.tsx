import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDownloadPresignedUrl } from "@/lib/storage";
import { parseTemplateSlotSchema } from "@/lib/template-runtime";
import { ProjectEditor } from "@/components/editor/project-editor";

type PageProps = {
  params: { id: string };
};

export default async function ProjectPage({ params }: PageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const project = await prisma.project.findFirst({
    where: {
      id: params.id,
      userId: user.id
    },
    include: {
      template: true,
      assets: true,
      renderJobs: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!project) {
    notFound();
  }

  const [assets, latestRenderJob] = await Promise.all([
    Promise.all(
      project.assets.map(async (asset) => ({
        ...asset,
        createdAt: asset.createdAt.toISOString(),
        signedUrl: await getDownloadPresignedUrl(asset.storageKey)
      }))
    ),
    project.renderJobs[0]
      ? Promise.resolve({
          ...project.renderJobs[0],
          createdAt: project.renderJobs[0].createdAt.toISOString(),
          updatedAt: project.renderJobs[0].updatedAt.toISOString(),
          outputUrl: project.renderJobs[0].outputStorageKey
            ? await getDownloadPresignedUrl(project.renderJobs[0].outputStorageKey)
            : null
        })
      : Promise.resolve(null)
  ]);

  return (
    <ProjectEditor
      initial={{
        id: project.id,
        title: project.title,
        status: project.status,
        config: (project.config as Record<string, string | number | boolean>) ?? {},
        template: {
          slug: project.template.slug,
          name: project.template.name,
          slotSchema: parseTemplateSlotSchema(project.template.slotSchema)
        },
        assets,
        currentRenderJob: latestRenderJob
      }}
    />
  );
}
