import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { AudioAnalysisQuerySchema } from "@/lib/audio/schemas";
import { getAudioAnalysis } from "@/lib/audio/phase3";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const query = AudioAnalysisQuerySchema.parse({
      language: new URL(request.url).searchParams.get("language") ?? undefined,
      maxCandidates: new URL(request.url).searchParams.get("maxCandidates") ?? undefined,
      maxConfidence: new URL(request.url).searchParams.get("maxConfidence") ?? undefined
    });
    return jsonOk(await getAudioAnalysis(params.id, query));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

