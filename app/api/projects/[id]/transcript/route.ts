import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { patchTranscript, getTranscript } from "@/lib/transcript/service";
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
    const transcript = await getTranscript(params.id, query.language);
    return jsonOk(transcript);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const body = TranscriptPatchSchema.parse(await request.json());
    const result = await patchTranscript(params.id, body);
    return jsonOk(result);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
