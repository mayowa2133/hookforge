import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { TranscriptIssuesQuerySchema } from "@/lib/transcript/schemas";
import { getTranscript } from "@/lib/transcript/service";
import { buildTranscriptIssues } from "@/lib/transcript/issues";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const query = TranscriptIssuesQuerySchema.parse({
      language: new URL(request.url).searchParams.get("language") ?? undefined,
      minConfidence: new URL(request.url).searchParams.get("minConfidence") ?? undefined,
      limit: new URL(request.url).searchParams.get("limit") ?? undefined
    });
    const transcript = await getTranscript(params.id, query.language);
    const issues = buildTranscriptIssues({
      segments: transcript.segments,
      words: transcript.words,
      minConfidence: query.minConfidence
    }).slice(0, query.limit);

    return jsonOk({
      projectId: transcript.projectId,
      projectV2Id: transcript.projectV2Id,
      language: transcript.language,
      minConfidence: query.minConfidence,
      totalIssues: issues.length,
      byType: {
        LOW_CONFIDENCE: issues.filter((issue) => issue.type === "LOW_CONFIDENCE").length,
        OVERLAP: issues.filter((issue) => issue.type === "OVERLAP").length,
        TIMING_DRIFT: issues.filter((issue) => issue.type === "TIMING_DRIFT").length
      },
      issues
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
