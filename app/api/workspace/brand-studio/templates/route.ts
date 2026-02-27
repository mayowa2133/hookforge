import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { normalizeBrandStudioMetadata } from "@/lib/review-phase5-tools";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const LayoutPackSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120),
  aspectRatio: z.string().trim().min(1).max(16).optional(),
  sceneLayoutIds: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  tags: z.array(z.string().trim().min(2).max(32)).max(20).optional(),
  isDefault: z.boolean().optional()
});

const TemplatePackSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80).optional(),
  layoutPackId: z.string().trim().min(1).max(80).nullable().optional(),
  captionStylePresetId: z.string().trim().min(1).max(80).nullable().optional(),
  audioPreset: z.string().trim().min(1).max(64).nullable().optional(),
  tags: z.array(z.string().trim().min(2).max(32)).max(20).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const DistributionPresetSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120),
  connector: z.enum(["youtube", "drive", "package", "all"]).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).nullable().optional(),
  titleTemplate: z.string().trim().max(220).nullable().optional(),
  descriptionTemplate: z.string().trim().max(4000).nullable().optional(),
  tags: z.array(z.string().trim().min(2).max(32)).max(30).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional()
});

const MetadataPackSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120),
  connector: z.enum(["youtube", "drive", "package", "all"]).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string().trim().min(2).max(32)).max(30).optional()
});

const TemplatesSchema = z.object({
  layoutPacks: z.array(LayoutPackSchema).max(40).optional(),
  templatePacks: z.array(TemplatePackSchema).max(80).optional(),
  distributionPresets: z.array(DistributionPresetSchema).max(40).optional(),
  metadataPacks: z.array(MetadataPackSchema).max(80).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "workspace.projects.read",
      request
    });

    const preset = await prisma.workspaceBrandPreset.findUnique({
      where: {
        workspaceId: workspace.id
      },
      select: {
        id: true,
        metadata: true,
        updatedAt: true
      }
    });

    const normalized = normalizeBrandStudioMetadata(preset?.metadata);
    return jsonOk({
      workspaceId: workspace.id,
      brandPresetId: preset?.id ?? null,
      templates: {
        layoutPacks: normalized.layoutPacks,
        templatePacks: normalized.templatePacks,
        distributionPresets: normalized.distributionPresets,
        metadataPacks: normalized.metadataPacks,
        updatedAt: preset?.updatedAt.toISOString() ?? null
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { workspace, user } = await requireWorkspaceCapability({
      capability: "workspace.projects.write",
      request
    });
    const body = TemplatesSchema.parse(await request.json().catch(() => ({})));

    const existing = await prisma.workspaceBrandPreset.findUnique({
      where: {
        workspaceId: workspace.id
      },
      select: {
        metadata: true
      }
    });

    const existingMetadata = asRecord(existing?.metadata);
    const normalized = normalizeBrandStudioMetadata({
      ...existingMetadata,
      ...body.metadata,
      ...(body.layoutPacks ? { layoutPacks: body.layoutPacks } : {}),
      ...(body.templatePacks ? { templatePacks: body.templatePacks } : {}),
      ...(body.distributionPresets ? { distributionPresets: body.distributionPresets } : {}),
      ...(body.metadataPacks ? { metadataPacks: body.metadataPacks } : {})
    });

    const saved = await prisma.workspaceBrandPreset.upsert({
      where: {
        workspaceId: workspace.id
      },
      update: {
        updatedByUserId: user.id,
        metadata: normalized.metadata as Prisma.InputJsonValue
      },
      create: {
        workspaceId: workspace.id,
        updatedByUserId: user.id,
        metadata: normalized.metadata as Prisma.InputJsonValue
      }
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "brand_studio.templates.upsert",
      targetType: "workspace_brand_preset",
      targetId: saved.id,
      details: {
        layoutPackCount: normalized.layoutPacks.length,
        templatePackCount: normalized.templatePacks.length,
        distributionPresetCount: normalized.distributionPresets.length,
        metadataPackCount: normalized.metadataPacks.length
      }
    });

    return jsonOk({
      workspaceId: workspace.id,
      brandPresetId: saved.id,
      templates: {
        layoutPacks: normalized.layoutPacks,
        templatePacks: normalized.templatePacks,
        distributionPresets: normalized.distributionPresets,
        metadataPacks: normalized.metadataPacks,
        updatedAt: saved.updatedAt.toISOString()
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
