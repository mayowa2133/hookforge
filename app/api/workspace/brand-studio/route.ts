import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  normalizeBrandPresetInput,
  normalizeBrandStudioMetadata
} from "@/lib/review-phase5-tools";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const BrandKitSchema = z.object({
  primaryColor: z.string().trim().min(1).max(24).optional(),
  secondaryColor: z.string().trim().min(1).max(24).optional(),
  accentColor: z.string().trim().min(1).max(24).optional(),
  fontFamily: z.string().trim().min(1).max(120).optional(),
  logoAssetId: z.string().trim().min(1).max(120).optional(),
  watermarkAssetId: z.string().trim().min(1).max(120).optional()
});

const FontAssetSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120),
  family: z.string().trim().min(1).max(120).optional(),
  weight: z.number().int().min(100).max(900).optional(),
  style: z.enum(["normal", "italic"]).optional(),
  format: z.enum(["ttf", "otf", "woff", "woff2"]).optional(),
  assetId: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().max(2048).optional(),
  isVariable: z.boolean().optional(),
  fallback: z.string().trim().max(120).optional()
});

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

const BrandStudioSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  captionStylePresetId: z.string().trim().min(1).max(80).nullable().optional(),
  audioPreset: z.string().trim().min(1).max(64).nullable().optional(),
  defaultConnector: z.enum(["youtube", "drive", "package"]).optional(),
  defaultVisibility: z.enum(["private", "unlisted", "public"]).optional(),
  defaultTitlePrefix: z.string().trim().max(120).nullable().optional(),
  defaultTags: z.array(z.string().trim().min(2).max(32)).max(12).optional(),
  brandKit: BrandKitSchema.optional(),
  customFonts: z.array(FontAssetSchema).max(50).optional(),
  layoutPacks: z.array(LayoutPackSchema).max(40).optional(),
  templatePacks: z.array(TemplatePackSchema).max(80).optional(),
  distributionPresets: z.array(DistributionPresetSchema).max(40).optional(),
  metadataPacks: z.array(MetadataPackSchema).max(80).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

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
      include: {
        captionStylePreset: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    const normalizedMetadata = normalizeBrandStudioMetadata(preset?.metadata);

    return jsonOk({
      workspaceId: workspace.id,
      brandStudio: preset,
      details: normalizedMetadata
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
    const body = BrandStudioSchema.parse(await request.json().catch(() => ({})));
    const normalized = normalizeBrandPresetInput({
      name: body.name,
      captionStylePresetId: body.captionStylePresetId,
      audioPreset: body.audioPreset,
      defaultConnector: body.defaultConnector,
      defaultVisibility: body.defaultVisibility,
      defaultTitlePrefix: body.defaultTitlePrefix,
      defaultTags: body.defaultTags,
      metadata: {
        ...(body.metadata ?? {}),
        brandKit: body.brandKit,
        customFonts: body.customFonts,
        layoutPacks: body.layoutPacks,
        templatePacks: body.templatePacks,
        distributionPresets: body.distributionPresets,
        metadataPacks: body.metadataPacks
      }
    });
    const metadata = normalized.metadata as Prisma.InputJsonValue;

    const saved = await prisma.workspaceBrandPreset.upsert({
      where: {
        workspaceId: workspace.id
      },
      update: {
        updatedByUserId: user.id,
        ...normalized,
        metadata
      },
      create: {
        workspaceId: workspace.id,
        updatedByUserId: user.id,
        ...normalized,
        metadata
      }
    });

    const normalizedMetadata = normalizeBrandStudioMetadata(saved.metadata);

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "brand_studio.upsert",
      targetType: "workspace_brand_preset",
      targetId: saved.id,
      details: {
        defaultConnector: saved.defaultConnector,
        defaultVisibility: saved.defaultVisibility,
        defaultTagsCount: saved.defaultTags.length,
        customFontsCount: normalizedMetadata.customFonts.length,
        layoutPackCount: normalizedMetadata.layoutPacks.length,
        templatePackCount: normalizedMetadata.templatePacks.length,
        distributionPresetCount: normalizedMetadata.distributionPresets.length,
        metadataPackCount: normalizedMetadata.metadataPacks.length
      }
    });

    return jsonOk({
      workspaceId: workspace.id,
      brandStudio: saved,
      details: normalizedMetadata
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
