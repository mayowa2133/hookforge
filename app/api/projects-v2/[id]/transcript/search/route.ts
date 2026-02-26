import { z } from "zod";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getTranscript } from "@/lib/transcript/service";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const QuerySchema = z.object({
  language: z.string().min(2).max(12).optional(),
  q: z.string().max(120).optional()
});

function computeMatchIndices(text: string, query: string) {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const start = lowerText.indexOf(lowerQuery);
  if (start < 0) {
    return null;
  }
  return {
    start,
    end: start + lowerQuery.length
  };
}

export async function GET(request: Request, { params }: Context) {
  try {
    const parsed = QuerySchema.parse({
      language: new URL(request.url).searchParams.get("language") ?? undefined,
      q: new URL(request.url).searchParams.get("q") ?? undefined
    });

    const startedAt = Date.now();
    const transcript = await getTranscript(params.id, parsed.language);
    const query = parsed.q?.trim() ?? "";
    const matches = query.length < 2
      ? []
      : transcript.segments
          .map((segment) => {
            const indices = computeMatchIndices(segment.text, query);
            if (!indices) {
              return null;
            }
            return {
              segmentId: segment.id,
              startMs: segment.startMs,
              endMs: segment.endMs,
              text: segment.text,
              confidenceAvg: segment.confidenceAvg,
              matchStart: indices.start,
              matchEnd: indices.end
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return jsonOk({
      projectId: transcript.projectId,
      projectV2Id: transcript.projectV2Id,
      language: transcript.language,
      query,
      totalSegments: transcript.segments.length,
      totalMatches: matches.length,
      matches,
      tookMs: Date.now() - startedAt
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
