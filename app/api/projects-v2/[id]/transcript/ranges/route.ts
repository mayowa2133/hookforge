import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { TranscriptRangeQuerySchema } from "@/lib/transcript/schemas";
import { getTranscript } from "@/lib/transcript/service";
import { buildSegmentWordRanges } from "@/lib/transcript/ranges";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const query = TranscriptRangeQuerySchema.parse({
      language: new URL(request.url).searchParams.get("language") ?? undefined,
      offset: new URL(request.url).searchParams.get("offset") ?? undefined,
      limit: new URL(request.url).searchParams.get("limit") ?? undefined
    });
    const transcript = await getTranscript(params.id, query.language);
    const ranges = buildSegmentWordRanges({
      segments: transcript.segments,
      words: transcript.words
    });
    const page = ranges.slice(query.offset, query.offset + query.limit);
    const nextOffset = query.offset + page.length;

    return jsonOk({
      projectId: transcript.projectId,
      projectV2Id: transcript.projectV2Id,
      language: transcript.language,
      totalWords: transcript.words.length,
      totalRanges: ranges.length,
      offset: query.offset,
      limit: query.limit,
      hasMore: nextOffset < ranges.length,
      nextOffset: nextOffset < ranges.length ? nextOffset : null,
      ranges: page
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
