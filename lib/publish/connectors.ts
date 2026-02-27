import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireProjectContext } from "@/lib/api-context";
import { getDownloadPresignedUrl } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { applyProjectExportProfile } from "@/lib/review-phase5";
import {
  normalizeBrandStudioMetadata,
  PHASE5_PUBLISH_VISIBILITY,
  type Phase5PublishVisibility
} from "@/lib/review-phase5-tools";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const PublishConnectorSchema = z.enum(["youtube", "drive", "package"]);

const DistributionPresetSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  connector: z.union([PublishConnectorSchema, z.literal("all")]).optional(),
  visibility: z.enum(PHASE5_PUBLISH_VISIBILITY).nullable().optional(),
  titleTemplate: z.string().trim().max(220).nullable().optional(),
  descriptionTemplate: z.string().trim().max(4000).nullable().optional(),
  tags: z.array(z.string().trim().min(2).max(32)).max(30).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional()
});

const MetadataPackSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  connector: z.union([PublishConnectorSchema, z.literal("all")]).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string().trim().min(2).max(32)).max(30).optional()
});

export const PublishExportSchema = z.object({
  exportProfileId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(30).optional(),
  visibility: z.enum(PHASE5_PUBLISH_VISIBILITY).optional(),
  distributionPresetId: z.string().trim().min(1).max(80).optional(),
  distributionPreset: DistributionPresetSchema.optional(),
  metadataPackId: z.string().trim().min(1).max(80).optional(),
  metadataPack: MetadataPackSchema.optional(),
  platformMetadata: z.record(z.string(), z.unknown()).optional()
});

export const PublishBatchExportSchema = z.object({
  connectors: z.array(PublishConnectorSchema).min(1).max(3),
  baseInput: PublishExportSchema.optional(),
  byConnector: z.record(PublishConnectorSchema, PublishExportSchema).optional()
});

type DistributionPreset = {
  id: string;
  name: string;
  connector: z.infer<typeof PublishConnectorSchema> | "all";
  visibility: Phase5PublishVisibility | null;
  titleTemplate: string | null;
  descriptionTemplate: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  isDefault: boolean;
};

type MetadataPack = {
  id: string;
  name: string;
  connector: z.infer<typeof PublishConnectorSchema> | "all";
  metadata: Record<string, unknown>;
  tags: string[];
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function applyTemplate(template: string | null, params: Record<string, string>) {
  if (!template) {
    return null;
  }
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => params[key] ?? "").trim();
}

function selectDistributionPreset(params: {
  connector: z.infer<typeof PublishConnectorSchema>;
  input: z.infer<typeof PublishExportSchema>;
  presets: DistributionPreset[];
}) {
  const { input, connector, presets } = params;

  if (input.distributionPreset) {
    const parsed = DistributionPresetSchema.parse(input.distributionPreset);
    return {
      id: parsed.id ?? "inline_distribution",
      name: parsed.name ?? "Inline Distribution",
      connector: parsed.connector ?? connector,
      visibility: parsed.visibility ?? null,
      titleTemplate: parsed.titleTemplate ?? null,
      descriptionTemplate: parsed.descriptionTemplate ?? null,
      tags: parsed.tags ?? [],
      metadata: parsed.metadata ?? {},
      isDefault: parsed.isDefault === true
    } as DistributionPreset;
  }

  if (input.distributionPresetId) {
    const direct = presets.find((preset) => preset.id === input.distributionPresetId);
    if (direct) {
      return direct;
    }
  }

  const scoped = presets.filter((preset) => preset.connector === connector || preset.connector === "all");
  return scoped.find((preset) => preset.isDefault) ?? scoped[0] ?? null;
}

function selectMetadataPack(params: {
  connector: z.infer<typeof PublishConnectorSchema>;
  input: z.infer<typeof PublishExportSchema>;
  packs: MetadataPack[];
}) {
  const { input, connector, packs } = params;

  if (input.metadataPack) {
    const parsed = MetadataPackSchema.parse(input.metadataPack);
    return {
      id: parsed.id ?? "inline_metadata",
      name: parsed.name ?? "Inline Metadata",
      connector: parsed.connector ?? connector,
      metadata: parsed.metadata,
      tags: parsed.tags ?? []
    } as MetadataPack;
  }

  if (input.metadataPackId) {
    const direct = packs.find((pack) => pack.id === input.metadataPackId);
    if (direct) {
      return direct;
    }
  }

  return packs.find((pack) => pack.connector === connector || pack.connector === "all") ?? null;
}

function buildConnectorPayload(params: {
  connector: z.infer<typeof PublishConnectorSchema>;
  distributionPreset: DistributionPreset | null;
  metadataPack: MetadataPack | null;
  platformMetadata: Record<string, unknown>;
  resolvedTitle: string;
}) {
  const baseMetadata = {
    ...params.metadataPack?.metadata,
    ...params.distributionPreset?.metadata,
    ...params.platformMetadata
  };

  if (params.connector === "youtube") {
    return {
      channelId: typeof baseMetadata.channelId === "string" ? baseMetadata.channelId : null,
      categoryId: typeof baseMetadata.categoryId === "string" ? baseMetadata.categoryId : "22",
      playlistId: typeof baseMetadata.playlistId === "string" ? baseMetadata.playlistId : null,
      madeForKids: baseMetadata.madeForKids === true
    };
  }

  if (params.connector === "drive") {
    return {
      folderId: typeof baseMetadata.folderId === "string" ? baseMetadata.folderId : null,
      convertToGoogleVideo: baseMetadata.convertToGoogleVideo === true,
      shareWith: Array.isArray(baseMetadata.shareWith)
        ? baseMetadata.shareWith.filter((entry): entry is string => typeof entry === "string").slice(0, 25)
        : []
    };
  }

  return {
    packageName: typeof baseMetadata.packageName === "string"
      ? baseMetadata.packageName
      : params.resolvedTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    includeProjectFile: baseMetadata.includeProjectFile !== false,
    includeTranscript: baseMetadata.includeTranscript !== false
  };
}

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

  const normalizedBrand = normalizeBrandStudioMetadata(brandPreset?.metadata);
  const distributionPreset = selectDistributionPreset({
    connector: params.connector,
    input: params.input,
    presets: normalizedBrand.distributionPresets
  });
  const metadataPack = selectMetadataPack({
    connector: params.connector,
    input: params.input,
    packs: normalizedBrand.metadataPacks
  });

  const titlePrefix = brandPreset?.defaultTitlePrefix?.trim() ?? "";
  const baseTitle = params.input.title ?? ctx.projectV2.title;
  const resolvedTitle = titlePrefix.length > 0 ? `${titlePrefix} ${baseTitle}`.trim() : baseTitle;

  const templateParams = {
    projectTitle: ctx.projectV2.title,
    workspaceName: ctx.workspace.name,
    title: resolvedTitle
  };
  const templatedTitle = applyTemplate(distributionPreset?.titleTemplate ?? null, templateParams) ?? resolvedTitle;
  const templatedDescription = applyTemplate(
    distributionPreset?.descriptionTemplate ?? null,
    templateParams
  ) ?? (params.input.description ?? "");

  const mergedTags = Array.from(
    new Set([
      ...(brandPreset?.defaultTags ?? []),
      ...(distributionPreset?.tags ?? []),
      ...(metadataPack?.tags ?? []),
      ...(params.input.tags ?? [])
    ])
  );

  const resolvedVisibility = params.input.visibility
    ?? distributionPreset?.visibility
    ?? (brandPreset?.defaultVisibility === "public" || brandPreset?.defaultVisibility === "unlisted" || brandPreset?.defaultVisibility === "private"
      ? brandPreset.defaultVisibility
      : "private");

  const platformMetadata = asRecord(params.input.platformMetadata);
  const connectorPayload = buildConnectorPayload({
    connector: params.connector,
    distributionPreset,
    metadataPack,
    platformMetadata,
    resolvedTitle: templatedTitle
  });
  const payload = {
    title: templatedTitle,
    description: templatedDescription,
    tags: mergedTags,
    visibility: resolvedVisibility,
    distributionPreset,
    metadataPack,
    connectorPayload,
    platformMetadata
  } as Prisma.InputJsonValue;

  const created = await prisma.publishConnectorJob.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      exportProfileId: appliedProfileId,
      connector: params.connector,
      status: "QUEUED",
      payload,
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
            downloadUrl: latestRender.downloadUrl,
            distributionPresetId: distributionPreset?.id ?? null,
            metadataPackId: metadataPack?.id ?? null,
            payloadDigest: {
              title: templatedTitle,
              visibility: resolvedVisibility,
              tagsCount: mergedTags.length
            }
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
      exportProfileId: appliedProfileId,
      distributionPresetId: distributionPreset?.id ?? null,
      metadataPackId: metadataPack?.id ?? null,
      visibility: resolvedVisibility
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
      error: jobs.filter((job) => job.status === "ERROR").length,
      byConnector: jobs.reduce<Record<string, number>>((acc, job) => {
        acc[job.connector] = (acc[job.connector] ?? 0) + 1;
        return acc;
      }, {})
    }
  };
}

export async function listProjectDistributionPresets(projectIdOrV2Id: string) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const preset = await prisma.workspaceBrandPreset.findUnique({
    where: {
      workspaceId: ctx.workspace.id
    },
    select: {
      metadata: true,
      updatedAt: true
    }
  });

  const normalized = normalizeBrandStudioMetadata(preset?.metadata);
  return {
    workspaceId: ctx.workspace.id,
    projectV2Id: ctx.projectV2.id,
    distributionPresets: normalized.distributionPresets,
    metadataPacks: normalized.metadataPacks,
    updatedAt: preset?.updatedAt.toISOString() ?? null
  };
}
