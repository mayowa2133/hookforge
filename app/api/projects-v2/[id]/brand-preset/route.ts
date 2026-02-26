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
        input: body
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
