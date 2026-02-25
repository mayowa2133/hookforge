import type { TemplateSlotSchemaJsonType } from "@/lib/template-schema";
import { prisma } from "@/lib/prisma";

export const SYSTEM_FREEFORM_TEMPLATE_SLUG = "__system_freeform_editor";
export const SYSTEM_FREEFORM_TEMPLATE_NAME = "System Freeform Editor";

export const systemFreeformTemplateSchema: TemplateSlotSchemaJsonType = {
  slots: [
    {
      key: "seed_media",
      label: "Seed media",
      kinds: ["VIDEO", "IMAGE", "AUDIO"],
      required: false,
      helpText: "Internal compatibility slot. Freeform uploads are not limited to this slot."
    }
  ],
  controls: [],
  recipeCard: {
    filmingTips: [
      "Upload one or more clips to start.",
      "Use chat to request trims, splits, and pacing changes.",
      "Use timeline controls for precise manual edits."
    ],
    structure: [
      "Upload",
      "Auto transcript",
      "Chat plan",
      "Apply",
      "Render"
    ],
    caution: [
      "Upload only media you own or have permission to use."
    ]
  },
  previewImage: "/demo-assets/template-split-screen.svg"
};

export function isSystemTemplateSlug(slug: string) {
  return slug === SYSTEM_FREEFORM_TEMPLATE_SLUG;
}

export async function ensureSystemFreeformTemplate() {
  return prisma.template.upsert({
    where: {
      slug: SYSTEM_FREEFORM_TEMPLATE_SLUG
    },
    update: {
      name: SYSTEM_FREEFORM_TEMPLATE_NAME,
      description: "Internal freeform editor compatibility template.",
      tags: ["system", "freeform"],
      slotSchema: systemFreeformTemplateSchema
    },
    create: {
      slug: SYSTEM_FREEFORM_TEMPLATE_SLUG,
      name: SYSTEM_FREEFORM_TEMPLATE_NAME,
      description: "Internal freeform editor compatibility template.",
      tags: ["system", "freeform"],
      slotSchema: systemFreeformTemplateSchema
    }
  });
}
