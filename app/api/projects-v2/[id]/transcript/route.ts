import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getTranscript, patchTranscript } from "@/lib/transcript/service";
import { TranscriptPatchSchema, TranscriptQuerySchema } from "@/lib/transcript/schemas";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const query = TranscriptQuerySchema.parse({
      language: new URL(request.url).searchParams.get("language") ?? undefined
    });
    return jsonOk(await getTranscript(params.id, query.language));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const body = TranscriptPatchSchema.parse(await request.json());
    return jsonOk(await patchTranscript(params.id, body));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
