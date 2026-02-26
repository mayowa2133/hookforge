import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { AudioEnhanceUndoSchema } from "@/lib/audio/schemas";
import { undoAudioEnhancement } from "@/lib/audio/phase3";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = AudioEnhanceUndoSchema.parse(await request.json());
    return jsonOk(await undoAudioEnhancement(params.id, body.undoToken, Boolean(body.force)));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

