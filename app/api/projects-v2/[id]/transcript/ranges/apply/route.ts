import { jsonError, jsonOk, routeErrorToResponse } from "@/lib/http";
import { TranscriptRangePreviewSchema } from "@/lib/transcript/schemas";
import { resolveTranscriptRangeSelection } from "@/lib/transcript/ranges";
import { getTranscript, patchTranscript } from "@/lib/transcript/service";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = TranscriptRangePreviewSchema.parse(await request.json());
    const transcript = await getTranscript(params.id, body.language);
    const range = resolveTranscriptRangeSelection(transcript.words, body.selection);
    if (!range) {
      return jsonError("Could not resolve transcript range selection", 400);
    }

    const result = await patchTranscript(params.id, {
      language: body.language,
      operations: [
        {
          op: "delete_range",
          startMs: range.startMs,
          endMs: range.endMs
        }
      ],
      minConfidenceForRipple: body.minConfidenceForRipple,
      previewOnly: false
    });

    return jsonOk({
      mode: "APPLY" as const,
      selection: range,
      ...result
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
