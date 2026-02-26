import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { TranscriptSpeakerBatchSchema } from "@/lib/transcript/schemas";
import { getTranscript, patchTranscript } from "@/lib/transcript/service";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

function normalizeSpeakerLabel(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export async function POST(request: Request, { params }: Context) {
  try {
    const body = TranscriptSpeakerBatchSchema.parse(await request.json());
    const transcript = await getTranscript(params.id, body.language);
    const segmentIdFilter = body.segmentIds ? new Set(body.segmentIds) : null;
    const fromSpeaker = body.fromSpeakerLabel ? normalizeSpeakerLabel(body.fromSpeakerLabel) : "";

    const targetSegments = transcript.segments.filter((segment) => {
      if (segmentIdFilter && !segmentIdFilter.has(segment.id)) {
        return false;
      }
      if (fromSpeaker && normalizeSpeakerLabel(segment.speakerLabel) !== fromSpeaker) {
        return false;
      }
      if (typeof body.maxConfidence === "number" && typeof segment.confidenceAvg === "number" && segment.confidenceAvg > body.maxConfidence) {
        return false;
      }
      return true;
    });

    if (targetSegments.length === 0) {
      return jsonOk({
        affectedSegments: 0,
        applied: false,
        suggestionsOnly: false,
        revisionId: null,
        issues: [],
        timelineOps: []
      });
    }

    const result = await patchTranscript(params.id, {
      language: body.language,
      operations: targetSegments.map((segment) => ({
        op: "set_speaker" as const,
        segmentId: segment.id,
        speakerLabel: body.speakerLabel
      })),
      minConfidenceForRipple: body.minConfidenceForRipple
    });

    return jsonOk({
      affectedSegments: targetSegments.length,
      ...result
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
