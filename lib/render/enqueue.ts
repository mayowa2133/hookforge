import { ProjectStatus, RenderJobStatus, type PrismaClient } from "@prisma/client";

type MinimalDb = Pick<PrismaClient, "project" | "renderJob">;
type MinimalQueue = {
  add: (name: string, data: { renderJobId: string }) => Promise<unknown>;
};

type EnqueueParams = {
  projectId: string;
  userId: string;
  db?: MinimalDb;
  queue?: MinimalQueue;
};

export async function createAndEnqueueRenderJob({
  projectId,
  userId,
  db,
  queue
}: EnqueueParams) {
  const resolvedDb = db ?? ((await import("../prisma")).prisma as MinimalDb);
  const resolvedQueue = queue ?? ((await import("../queue")).renderQueue as MinimalQueue);

  const project = await resolvedDb.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, status: true }
  });

  if (!project) {
    throw new Error("Project not found");
  }

  if (project.status !== ProjectStatus.READY && project.status !== ProjectStatus.DONE && project.status !== ProjectStatus.ERROR) {
    throw new Error("Project is not ready for rendering");
  }

  const renderJob = await resolvedDb.renderJob.create({
    data: {
      projectId: project.id,
      status: RenderJobStatus.QUEUED,
      progress: 0
    }
  });

  await resolvedQueue.add("render", { renderJobId: renderJob.id });

  await resolvedDb.project.update({
    where: { id: project.id },
    data: { status: ProjectStatus.RENDERING }
  });

  return renderJob;
}
