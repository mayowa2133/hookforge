import { AssetKind, type Asset, type Template } from "@prisma/client";
import { z } from "zod";
import { TemplateSlotSchemaJson, type TemplateSlotSchemaJsonType } from "./template-schema";

export function parseTemplateSlotSchema(slotSchema: unknown): TemplateSlotSchemaJsonType {
  return TemplateSlotSchemaJson.parse(slotSchema);
}

export function getDefaultConfigFromTemplate(template: Template | { slotSchema: unknown }) {
  const schema = parseTemplateSlotSchema(template.slotSchema);
  return schema.controls.reduce<Record<string, string | number | boolean>>((acc, control) => {
    acc[control.key] = control.defaultValue;
    return acc;
  }, {});
}

export function isAssetKindAllowed(kind: AssetKind, allowedKinds: AssetKind[]) {
  return allowedKinds.includes(kind);
}

export function inferAssetKindFromMime(mimeType: string): AssetKind {
  if (mimeType.startsWith("video/")) return AssetKind.VIDEO;
  if (mimeType.startsWith("audio/")) return AssetKind.AUDIO;
  return AssetKind.IMAGE;
}

export function validateAssetAgainstSlot(
  slotSchema: TemplateSlotSchemaJsonType,
  slotKey: string,
  kind: AssetKind,
  durationSec?: number | null,
  options?: { enforceDuration?: boolean }
) {
  const slot = slotSchema.slots.find((entry) => entry.key === slotKey);
  if (!slot) {
    throw new Error(`Unknown slot key: ${slotKey}`);
  }
  if (!isAssetKindAllowed(kind, slot.kinds as AssetKind[])) {
    throw new Error(`Slot ${slotKey} does not accept asset kind ${kind}`);
  }
  if (options?.enforceDuration && slot.minDurationSec && kind === AssetKind.VIDEO) {
    if (typeof durationSec !== "number") {
      throw new Error(`Could not verify duration for slot ${slotKey}`);
    }
    if (durationSec < slot.minDurationSec) {
      throw new Error(`Slot ${slotKey} requires at least ${slot.minDurationSec}s`);
    }
  }
}

export function projectReadinessFromAssets(template: Template | { slotSchema: unknown }, assets: Pick<Asset, "slotKey">[]) {
  const schema = parseTemplateSlotSchema(template.slotSchema);
  const filled = new Set(assets.map((asset) => asset.slotKey));
  const missing = schema.slots.filter((slot) => slot.required && !filled.has(slot.key));
  return {
    ready: missing.length === 0,
    missingSlotKeys: missing.map((slot) => slot.key)
  };
}

export const ConfigInputSchema = z.record(z.unknown());

function canUseControlOverride(defaultValue: string | number | boolean, override: unknown) {
  const expectedType = typeof defaultValue;
  if (expectedType === "number") {
    return typeof override === "number" && Number.isFinite(override);
  }
  return typeof override === expectedType;
}

export function validateAndMergeConfig(template: Template | { slotSchema: unknown }, config: unknown) {
  const schema = parseTemplateSlotSchema(template.slotSchema);
  const defaults = schema.controls.reduce<Record<string, string | number | boolean>>((acc, control) => {
    acc[control.key] = control.defaultValue;
    return acc;
  }, {});

  if (!config) {
    return defaults;
  }

  const parsed = ConfigInputSchema.parse(config);
  for (const control of schema.controls) {
    const candidate = parsed[control.key];
    if (canUseControlOverride(control.defaultValue, candidate)) {
      defaults[control.key] = candidate as string | number | boolean;
    }
  }

  return defaults;
}
