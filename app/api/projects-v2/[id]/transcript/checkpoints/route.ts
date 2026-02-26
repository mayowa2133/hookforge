import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { listTranscriptCheckpoints } from "@/lib/transcript/document";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const language = new URL(request.url).searchParams.get("language") ?? undefined;
    return jsonOk(await listTranscriptCheckpoints(params.id, language));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
