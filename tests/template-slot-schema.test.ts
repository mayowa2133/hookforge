import { describe, expect, it } from "vitest";
import { templateCatalog } from "../lib/template-catalog";
import { TemplateSlotSchemaJson } from "../lib/template-schema";

describe("template slot schema", () => {
  it("validates all template catalog entries", () => {
    for (const template of templateCatalog) {
      expect(() => TemplateSlotSchemaJson.parse(template.slotSchema)).not.toThrow();
    }
  });

  it("has at least five production templates", () => {
    expect(templateCatalog.length).toBeGreaterThanOrEqual(5);
  });
});
