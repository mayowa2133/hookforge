import { z } from "zod";

export const AssetKindEnum = z.enum(["VIDEO", "IMAGE", "AUDIO"]);

export const TemplateSlotSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kinds: z.array(AssetKindEnum).min(1),
  required: z.boolean().default(true),
  minDurationSec: z.number().positive().optional(),
  helpText: z.string().optional()
});

export const TemplateControlSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["number", "boolean", "select", "text"]),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  helpText: z.string().optional()
});

export const RecipeCardSchema = z.object({
  filmingTips: z.array(z.string()),
  structure: z.array(z.string()),
  caution: z.array(z.string()).default([])
});

export const TemplateSlotSchemaJson = z.object({
  slots: z.array(TemplateSlotSchema).min(1),
  controls: z.array(TemplateControlSchema).default([]),
  recipeCard: RecipeCardSchema,
  previewImage: z.string().optional()
});

export type TemplateSlot = z.infer<typeof TemplateSlotSchema>;
export type TemplateControl = z.infer<typeof TemplateControlSchema>;
export type TemplateSlotSchemaJsonType = z.infer<typeof TemplateSlotSchemaJson>;
