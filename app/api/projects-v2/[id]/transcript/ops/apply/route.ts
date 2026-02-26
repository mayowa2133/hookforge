import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { TranscriptPatchSchema } from "@/lib/transcript/schemas";
import { patchTranscript } from "@/lib/transcript/service";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = TranscriptPatchSchema.parse(await request.json());
    const result = await patchTranscript(params.id, {
      ...body,
      previewOnly: false
    });
    return jsonOk({
      mode: "APPLY" as const,
      ...result
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
