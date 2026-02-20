import { describe, expect, it } from "vitest";
import { estimatePhase5DubbingCredits, normalizeTargetLanguages } from "@/lib/ai/phase5";

describe("phase5 localization/public-api tools", () => {
  it("normalizes and bounds target language lists", () => {
    const normalized = normalizeTargetLanguages([" ES ", "fr", "es", "xx", "de", "it", "pt", "ja", "ko", "hi", "ar"]);

    expect(normalized).toEqual(["es", "fr", "de", "it", "pt", "ja", "ko", "hi"]);
  });

  it("estimates channel-aware dubbing credits", () => {
    expect(
      estimatePhase5DubbingCredits({
        targetLanguageCount: 2,
        lipDub: false,
        channel: "internal"
      })
    ).toBe(240);

    expect(
      estimatePhase5DubbingCredits({
        targetLanguageCount: 2,
        lipDub: true,
        channel: "public"
      })
    ).toBe(270);
  });
});
