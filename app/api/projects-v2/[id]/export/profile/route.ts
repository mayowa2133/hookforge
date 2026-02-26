import { z } from "zod";
import { applyProjectExportProfile, listProjectExportProfiles } from "@/lib/review-phase5";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const CreateExportProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  container: z.string().trim().min(2).max(24).optional(),
  resolution: z.string().trim().min(7).max(24).optional(),
  fps: z.number().int().min(12).max(120).optional(),
  videoBitrateKbps: z.number().int().min(100).max(120000).nullable().optional(),
  audioBitrateKbps: z.number().int().min(32).max(1024).nullable().optional(),
  audioPreset: z.string().trim().min(1).max(80).nullable().optional(),
  captionStylePresetId: z.string().trim().min(1).max(120).nullable().optional(),
  isDefault: z.boolean().optional(),
  config: z.record(z.unknown()).optional()
});

const ApplyExportProfileSchema = z.object({
  profileId: z.string().trim().min(1).max(120).optional(),
  createProfile: CreateExportProfileSchema.optional()
}).refine((value) => Boolean(value.profileId) || Boolean(value.createProfile), {
  message: "profileId or createProfile is required"
});

export async function GET(request: Request, { params }: Context) {
  try {
    const payload = await listProjectExportProfiles(params.id, request);
    return jsonOk(payload);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const body = ApplyExportProfileSchema.parse(await request.json());
    const payload = await applyProjectExportProfile({
      projectIdOrV2Id: params.id,
      request,
      profileId: body.profileId,
      createProfile: body.createProfile
    });
    return jsonOk(payload);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
