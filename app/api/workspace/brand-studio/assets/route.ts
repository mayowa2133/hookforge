import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { normalizeBrandStudioMetadata } from "@/lib/review-phase5-tools";
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

const AssetsSchema = z.object({
  brandKit: BrandKitSchema.optional(),
  customFonts: z.array(FontAssetSchema).max(50).optional(),
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
      assets: {
        brandKit: normalized.brandKit,
        customFonts: normalized.customFonts,
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
    const body = AssetsSchema.parse(await request.json().catch(() => ({})));

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
      ...(body.brandKit ? { brandKit: body.brandKit } : {}),
      ...(body.customFonts ? { customFonts: body.customFonts } : {})
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
      action: "brand_studio.assets.upsert",
      targetType: "workspace_brand_preset",
      targetId: saved.id,
      details: {
        customFontsCount: normalized.customFonts.length,
        hasLogoAsset: Boolean(normalized.brandKit.logoAssetId)
      }
    });

    return jsonOk({
      workspaceId: workspace.id,
      brandPresetId: saved.id,
      assets: {
        brandKit: normalized.brandKit,
        customFonts: normalized.customFonts,
        updatedAt: saved.updatedAt.toISOString()
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
