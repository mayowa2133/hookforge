import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveLegacyProjectIdForUser } from "@/lib/project-id-bridge";
import { getDownloadPresignedUrl } from "@/lib/storage";
import { validateAndMergeConfig } from "@/lib/template-runtime";
import { routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const UpdateProjectSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  config: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});

export async function GET(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const legacyProjectId = await resolveLegacyProjectIdForUser({
    projectIdOrV2Id: params.id,
    userId: user.id
  });
  if (!legacyProjectId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const project = await prisma.project.findFirst({
    where: {
      id: legacyProjectId
    },
    include: {
      template: true,
      assets: true,
      renderJobs: {
        orderBy: { createdAt: "desc" },
        take: 5
      }
    }
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const assets = await Promise.all(
    project.assets.map(async (asset) => ({
      ...asset,
      signedUrl: await getDownloadPresignedUrl(asset.storageKey)
    }))
  );

  const renderJobs = await Promise.all(
    project.renderJobs.map(async (job) => ({
      ...job,
      outputUrl: job.outputStorageKey ? await getDownloadPresignedUrl(job.outputStorageKey) : null
    }))
  );

  return NextResponse.json({
    project: {
      ...project,
      assets,
      renderJobs
    }
  });
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const legacyProjectId = await resolveLegacyProjectIdForUser({
      projectIdOrV2Id: params.id,
      userId: user.id
    });
    if (!legacyProjectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const body = UpdateProjectSchema.parse(await request.json());

    const project = await prisma.project.findFirst({
      where: {
        id: legacyProjectId
      },
      include: {
        template: true
      }
    });

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const currentConfig = (project.config ?? {}) as Record<string, string | number | boolean>;
    const mergedConfig = body.config
      ? validateAndMergeConfig(project.template, { ...currentConfig, ...body.config })
      : currentConfig;

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        title: body.title ?? project.title,
        config: mergedConfig
      },
      select: {
        id: true,
        title: true,
        status: true,
        config: true,
        updatedAt: true
      }
    });

    return NextResponse.json({ project: updated });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
