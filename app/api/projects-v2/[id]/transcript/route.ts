import { z } from "zod";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getTranscript, patchTranscript } from "@/lib/transcript/service";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const QuerySchema = z.object({
  language: z.string().min(2).max(12).optional()
});

const TranscriptPatchOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("replace_text"),
    segmentId: z.string().min(1),
    text: z.string().min(1).max(400)
  }),
  z.object({
    op: z.literal("split_segment"),
    segmentId: z.string().min(1),
    splitMs: z.number().int().min(0)
  }),
  z.object({
    op: z.literal("merge_segments"),
    firstSegmentId: z.string().min(1),
    secondSegmentId: z.string().min(1)
  }),
  z.object({
    op: z.literal("delete_range"),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(1)
  }),
  z.object({
    op: z.literal("set_speaker"),
    segmentId: z.string().min(1),
    speakerLabel: z.string().max(80).nullable()
  }),
  z.object({
    op: z.literal("normalize_punctuation"),
    segmentIds: z.array(z.string().min(1)).max(240).optional()
  })
]);

const PatchSchema = z.object({
  language: z.string().min(2).max(12).default("en"),
  operations: z.array(TranscriptPatchOperationSchema).min(1),
  minConfidenceForRipple: z.number().min(0.55).max(0.99).default(0.86),
  previewOnly: z.boolean().optional()
});

export async function GET(request: Request, { params }: Context) {
  try {
    const query = QuerySchema.parse({
      language: new URL(request.url).searchParams.get("language") ?? undefined
    });
    return jsonOk(await getTranscript(params.id, query.language));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const body = PatchSchema.parse(await request.json());
    return jsonOk(await patchTranscript(params.id, body));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
