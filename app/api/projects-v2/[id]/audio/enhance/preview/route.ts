import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { AudioEnhanceSchema } from "@/lib/audio/schemas";
import { previewAudioEnhancement } from "@/lib/audio/phase3";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = AudioEnhanceSchema.parse(await request.json());
    return jsonOk(await previewAudioEnhancement(params.id, body));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

