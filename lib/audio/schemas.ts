import { z } from "zod";

export const AudioLanguageSchema = z.string().min(2).max(12).default("en");

export const AudioEnhancementPresetSchema = z.enum([
  "clean_voice",
  "dialogue_enhance",
  "broadcast_loudness",
  "custom"
]);

export const AudioAnalysisQuerySchema = z.object({
  language: AudioLanguageSchema,
  maxCandidates: z.coerce.number().int().min(1).max(400).default(120),
  maxConfidence: z.coerce.number().min(0).max(1).default(0.94)
});

export const AudioEnhanceSchema = z.object({
  language: AudioLanguageSchema,
  preset: AudioEnhancementPresetSchema.default("dialogue_enhance"),
  denoise: z.boolean().optional(),
  clarity: z.boolean().optional(),
  deEsser: z.boolean().optional(),
  normalizeLoudness: z.boolean().optional(),
  bypassEnhancement: z.boolean().optional(),
  soloPreview: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  targetLufs: z.number().min(-24).max(-10).default(-14),
  intensity: z.number().min(0.2).max(1.6).default(1)
});

export const AudioEnhanceUndoSchema = z.object({
  undoToken: z.string().min(8),
  force: z.boolean().optional()
});

export const AudioFillerSchema = z.object({
  language: AudioLanguageSchema,
  candidateIds: z.array(z.string().min(1)).max(400).optional(),
  maxCandidates: z.number().int().min(1).max(400).default(80),
  maxConfidence: z.number().min(0).max(1).default(0.92),
  confirmed: z.boolean().optional(),
  minConfidenceForRipple: z.number().min(0.55).max(0.99).default(0.86)
});
