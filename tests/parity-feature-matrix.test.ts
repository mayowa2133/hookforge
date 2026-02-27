import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("descript parity feature matrix", () => {
  it("pins baseline date and maps every feature to api/ui/test evidence", () => {
    const raw = readFileSync(resolve(process.cwd(), "docs/parity/descript_feature_matrix.json"), "utf8");
    const matrix = JSON.parse(raw) as {
      baselineDate: string;
      competitor: string;
      features: Array<{
        id: string;
        coverage: {
          api: string[];
          ui: string[];
          tests: string[];
        };
      }>;
    };

    expect(matrix.competitor).toBe("Descript");
    expect(matrix.baselineDate).toBe("2026-02-26");
    expect(matrix.features.length).toBeGreaterThan(0);
    expect(
      matrix.features.every(
        (feature) =>
          feature.id.trim().length > 0 &&
          feature.coverage.api.length > 0 &&
          feature.coverage.ui.length > 0 &&
          feature.coverage.tests.length > 0
      )
    ).toBe(true);
  });
});

