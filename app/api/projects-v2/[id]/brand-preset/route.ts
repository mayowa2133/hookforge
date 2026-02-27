import { z } from "zod";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getWorkspaceBrandPreset, upsertWorkspaceBrandPreset } from "@/lib/review-phase5";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const BrandPresetUpsertSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  captionStylePresetId: z.string().trim().min(1).max(80).nullable().optional(),
  audioPreset: z.string().trim().min(1).max(64).nullable().optional(),
  defaultConnector: z.enum(["youtube", "drive", "package"]).optional(),
  defaultVisibility: z.enum(["private", "unlisted", "public"]).optional(),
  defaultTitlePrefix: z.string().trim().max(120).nullable().optional(),
  defaultTags: z.array(z.string().trim().min(2).max(32)).max(12).optional(),
  brandKit: z.object({
    primaryColor: z.string().trim().min(1).max(24).optional(),
    secondaryColor: z.string().trim().min(1).max(24).optional(),
    accentColor: z.string().trim().min(1).max(24).optional(),
    fontFamily: z.string().trim().min(1).max(120).optional(),
    logoAssetId: z.string().trim().min(1).max(120).optional(),
    watermarkAssetId: z.string().trim().min(1).max(120).optional()
  }).optional(),
  customFonts: z.array(
    z.object({
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
    })
  ).max(50).optional(),
  layoutPacks: z.array(
    z.object({
      id: z.string().trim().min(1).max(80).optional(),
      name: z.string().trim().min(1).max(120),
      aspectRatio: z.string().trim().min(1).max(16).optional(),
      sceneLayoutIds: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
      tags: z.array(z.string().trim().min(2).max(32)).max(20).optional(),
      isDefault: z.boolean().optional()
    })
  ).max(40).optional(),
  templatePacks: z.array(
    z.object({
      id: z.string().trim().min(1).max(80).optional(),
      name: z.string().trim().min(1).max(120),
      category: z.string().trim().min(1).max(80).optional(),
      layoutPackId: z.string().trim().min(1).max(80).nullable().optional(),
      captionStylePresetId: z.string().trim().min(1).max(80).nullable().optional(),
      audioPreset: z.string().trim().min(1).max(64).nullable().optional(),
      tags: z.array(z.string().trim().min(2).max(32)).max(20).optional(),
      metadata: z.record(z.string(), z.unknown()).optional()
    })
  ).max(80).optional(),
  distributionPresets: z.array(
    z.object({
      id: z.string().trim().min(1).max(80).optional(),
      name: z.string().trim().min(1).max(120),
      connector: z.enum(["youtube", "drive", "package", "all"]).optional(),
      visibility: z.enum(["private", "unlisted", "public"]).nullable().optional(),
      titleTemplate: z.string().trim().max(220).nullable().optional(),
      descriptionTemplate: z.string().trim().max(4000).nullable().optional(),
      tags: z.array(z.string().trim().min(2).max(32)).max(30).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      isDefault: z.boolean().optional()
    })
  ).max(40).optional(),
  metadataPacks: z.array(
    z.object({
      id: z.string().trim().min(1).max(80).optional(),
      name: z.string().trim().min(1).max(120),
      connector: z.enum(["youtube", "drive", "package", "all"]).optional(),
      metadata: z.record(z.string(), z.unknown()).default({}),
      tags: z.array(z.string().trim().min(2).max(32)).max(30).optional()
    })
  ).max(80).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export async function GET(request: Request, { params }: Context) {
  try {
    return jsonOk(await getWorkspaceBrandPreset(params.id, request));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const body = BrandPresetUpsertSchema.parse(await request.json());
    return jsonOk(
      await upsertWorkspaceBrandPreset({
        projectIdOrV2Id: params.id,
        request,
        input: {
          ...body,
          metadata: {
            ...(body.metadata ?? {}),
            brandKit: body.brandKit,
            customFonts: body.customFonts,
            layoutPacks: body.layoutPacks,
            templatePacks: body.templatePacks,
            distributionPresets: body.distributionPresets,
            metadataPacks: body.metadataPacks
          }
        }
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
