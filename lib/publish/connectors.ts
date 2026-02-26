import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireProjectContext } from "@/lib/api-context";
import { getDownloadPresignedUrl } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { applyProjectExportProfile } from "@/lib/review-phase5";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const PublishConnectorSchema = z.enum(["youtube", "drive", "package"]);

export const PublishExportSchema = z.object({
  exportProfileId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(30).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional()
});

export const PublishBatchExportSchema = z.object({
  connectors: z.array(PublishConnectorSchema).min(1).max(3),
  baseInput: PublishExportSchema.optional(),
  byConnector: z.record(PublishConnectorSchema, PublishExportSchema).optional()
});

async function resolveLatestRender(projectId: string) {
  const latestDone = await prisma.renderJob.findFirst({
    where: {
      projectId,
      status: "DONE",
      outputStorageKey: {
        not: null
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });
  if (!latestDone?.outputStorageKey) {
    return null;
  }
  const downloadUrl = await getDownloadPresignedUrl(latestDone.outputStorageKey, 3600);
  return {
    renderJobId: latestDone.id,
    outputStorageKey: latestDone.outputStorageKey,
    downloadUrl
  };
}

export async function enqueuePublishConnectorExport(params: {
  projectIdOrV2Id: string;
  connector: z.infer<typeof PublishConnectorSchema>;
  input: z.infer<typeof PublishExportSchema>;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const [brandPreset, defaultExportProfile] = await Promise.all([
    prisma.workspaceBrandPreset.findUnique({
      where: {
        workspaceId: ctx.workspace.id
      }
    }),
    prisma.exportProfile.findFirst({
      where: {
        workspaceId: ctx.workspace.id,
        isDefault: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        id: true
      }
    })
  ]);

  let appliedProfileId: string | null = null;
  const resolvedProfileId = params.input.exportProfileId ?? defaultExportProfile?.id;
  if (resolvedProfileId) {
    await applyProjectExportProfile({
      projectIdOrV2Id: ctx.projectV2.id,
      profileId: resolvedProfileId
    });
    appliedProfileId = resolvedProfileId;
  }

  const titlePrefix = brandPreset?.defaultTitlePrefix?.trim() ?? "";
  const baseTitle = params.input.title ?? ctx.projectV2.title;
  const resolvedTitle = titlePrefix.length > 0 ? `${titlePrefix} ${baseTitle}`.trim() : baseTitle;
  const mergedTags = Array.from(new Set([...(brandPreset?.defaultTags ?? []), ...(params.input.tags ?? [])]));
  const resolvedVisibility = params.input.visibility
    ?? (brandPreset?.defaultVisibility === "public" || brandPreset?.defaultVisibility === "unlisted" || brandPreset?.defaultVisibility === "private"
      ? brandPreset.defaultVisibility
      : "private");

  const created = await prisma.publishConnectorJob.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      exportProfileId: appliedProfileId,
      connector: params.connector,
      status: "QUEUED",
      payload: {
        title: resolvedTitle,
        description: params.input.description ?? "",
        tags: mergedTags,
        visibility: resolvedVisibility
      },
      createdByUserId: ctx.user.id
    }
  });

  const latestRender = ctx.legacyProject.id ? await resolveLatestRender(ctx.legacyProject.id) : null;

  const updated = await prisma.publishConnectorJob.update({
    where: {
      id: created.id
    },
    data: {
      status: latestRender ? "DONE" : "ERROR",
      output: latestRender
        ? {
            connector: params.connector,
            message: "Export package prepared.",
            renderJobId: latestRender.renderJobId,
            outputStorageKey: latestRender.outputStorageKey,
            downloadUrl: latestRender.downloadUrl
          }
        : Prisma.JsonNull,
      errorMessage: latestRender ? null : "No completed render found. Render final output before publishing."
    }
  });

  await recordWorkspaceAuditEvent({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: "publish.connector.export",
    targetType: "publish_job",
    targetId: updated.id,
    details: {
      connector: params.connector,
      status: updated.status,
      exportProfileId: appliedProfileId
    }
  });

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    publishJob: {
      id: updated.id,
      connector: updated.connector,
      status: updated.status,
      output: updated.output,
      errorMessage: updated.errorMessage,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString()
    }
  };
}

export async function getPublishConnectorJob(projectIdOrV2Id: string, jobId: string) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const job = await prisma.publishConnectorJob.findFirst({
    where: {
      id: jobId,
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id
    }
  });
  if (!job) {
    throw new Error("Publish job not found");
  }
  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    publishJob: {
      id: job.id,
      connector: job.connector,
      status: job.status,
      payload: job.payload,
      output: job.output,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString()
    }
  };
}

export async function enqueuePublishConnectorBatchExport(params: {
  projectIdOrV2Id: string;
  connectors: z.infer<typeof PublishConnectorSchema>[];
  baseInput?: z.infer<typeof PublishExportSchema>;
  byConnector?: Partial<Record<z.infer<typeof PublishConnectorSchema>, z.infer<typeof PublishExportSchema>>>;
}) {
  const uniqueConnectors = Array.from(new Set(params.connectors));
  const jobs: Array<{
    id: string;
    connector: string;
    status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
    output: unknown;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  }> = [];
  let projectId: string | null = null;
  let projectV2Id: string | null = null;
  for (const connector of uniqueConnectors) {
    const scopedInput = {
      ...(params.baseInput ?? {}),
      ...(params.byConnector?.[connector] ?? {})
    };
    const payload = await enqueuePublishConnectorExport({
      projectIdOrV2Id: params.projectIdOrV2Id,
      connector,
      input: PublishExportSchema.parse(scopedInput)
    });
    projectId = payload.projectId;
    projectV2Id = payload.projectV2Id;
    jobs.push(payload.publishJob);
  }
  return {
    projectId,
    projectV2Id,
    jobs,
    summary: {
      total: jobs.length,
      done: jobs.filter((job) => job.status === "DONE").length,
      error: jobs.filter((job) => job.status === "ERROR").length
    }
  };
}
