import { createHash } from "crypto";
import { prisma } from "./prisma";

export async function ensureProjectV2FromLegacy(params: {
  legacyProjectId: string;
  workspaceId: string;
  createdByUserId: string;
  title: string;
  status: "DRAFT" | "READY" | "RENDERING" | "DONE" | "ERROR";
}) {
  const existing = await prisma.projectV2.findUnique({
    where: { legacyProjectId: params.legacyProjectId },
    include: {
      currentRevision: true
    }
  });

  if (existing) {
    return existing;
  }

  const created = await prisma.projectV2.create({
    data: {
      workspaceId: params.workspaceId,
      legacyProjectId: params.legacyProjectId,
      createdByUserId: params.createdByUserId,
      title: params.title,
      status: params.status
    }
  });

  const revision = await prisma.timelineRevision.create({
    data: {
      projectId: created.id,
      revisionNumber: 1,
      operations: [],
      timelineHash: createHash("sha256").update(`${created.id}:1`).digest("hex"),
      createdByUserId: params.createdByUserId
    }
  });

  return prisma.projectV2.update({
    where: { id: created.id },
    data: {
      currentRevisionId: revision.id
    },
    include: {
      currentRevision: true
    }
  });
}

export async function appendTimelineRevision(params: {
  projectId: string;
  createdByUserId: string;
  operations: unknown;
}) {
  const current = await prisma.timelineRevision.findFirst({
    where: { projectId: params.projectId },
    orderBy: { revisionNumber: "desc" }
  });

  const nextRevisionNumber = (current?.revisionNumber ?? 0) + 1;
  const timelineHash = createHash("sha256")
    .update(JSON.stringify({ projectId: params.projectId, revision: nextRevisionNumber, operations: params.operations }))
    .digest("hex");

  const revision = await prisma.timelineRevision.create({
    data: {
      projectId: params.projectId,
      revisionNumber: nextRevisionNumber,
      operations: params.operations as never,
      timelineHash,
      createdByUserId: params.createdByUserId
    }
  });

  await prisma.projectV2.update({
    where: { id: params.projectId },
    data: {
      currentRevisionId: revision.id
    }
  });

  return revision;
}
