import { NextResponse } from "next/server";
import { z } from "zod";
import { routeErrorToResponse } from "@/lib/http";
import { registerProjectV2UploadedMedia } from "@/lib/projects-v2/media-register";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const RegisterSchema = z.object({
  storageKey: z.string().min(1),
  mimeType: z.string().min(3),
  originalFileName: z.string().min(1).max(220).optional(),
  slot: z.enum(["primary", "broll", "audio"]).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = RegisterSchema.parse(await request.json());
    const result = await registerProjectV2UploadedMedia({
      projectIdOrV2Id: params.id,
      storageKey: body.storageKey,
      mimeType: body.mimeType,
      originalFileName: body.originalFileName,
      slot: body.slot,
      sourceTag: "media_register_v2"
    });
    return NextResponse.json(result.response);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
