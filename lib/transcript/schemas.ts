import { z } from "zod";

export const TranscriptQuerySchema = z.object({
  language: z.string().min(2).max(12).optional()
});

export const TranscriptSearchQuerySchema = TranscriptQuerySchema.extend({
  q: z.string().max(120).optional()
});

export const TranscriptPatchOperationSchema = z.discriminatedUnion("op", [
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

export const TranscriptPatchSchema = z.object({
  language: z.string().min(2).max(12).default("en"),
  operations: z.array(TranscriptPatchOperationSchema).min(1),
  minConfidenceForRipple: z.number().min(0.55).max(0.99).default(0.86),
  previewOnly: z.boolean().optional()
});

export const TranscriptRangeQuerySchema = TranscriptQuerySchema.extend({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

export const TranscriptRangeSelectionSchema = z.object({
  startWordIndex: z.number().int().min(0),
  endWordIndex: z.number().int().min(0)
});

export const TranscriptRangePreviewSchema = z.object({
  language: z.string().min(2).max(12).default("en"),
  selection: TranscriptRangeSelectionSchema,
  minConfidenceForRipple: z.number().min(0.55).max(0.99).default(0.86)
});

export const TranscriptSpeakerBatchSchema = z.object({
  language: z.string().min(2).max(12).default("en"),
  speakerLabel: z.string().max(80).nullable(),
  fromSpeakerLabel: z.string().max(80).optional(),
  segmentIds: z.array(z.string().min(1)).max(2000).optional(),
  maxConfidence: z.number().min(0).max(1).optional(),
  minConfidenceForRipple: z.number().min(0.55).max(0.99).default(0.86)
});

export const TranscriptIssuesQuerySchema = TranscriptQuerySchema.extend({
  minConfidence: z.coerce.number().min(0).max(1).default(0.86),
  limit: z.coerce.number().int().min(1).max(5000).default(1200)
});

export type TranscriptPatchBody = z.infer<typeof TranscriptPatchSchema>;
