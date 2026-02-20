import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSLATION_TONE,
  mergeGlossaries,
  normalizeGlossary,
  normalizeProfileName
} from "@/lib/translation-profiles";

describe("translation profile helpers", () => {
  it("normalizes glossary keys and values safely", () => {
    const glossary = normalizeGlossary({
      " HookForge ": " HookForge  ",
      captions: " subtitle overlay ",
      "<script>": "alert(1)",
      "": "ignored"
    });

    expect(glossary.hookforge).toBe("HookForge");
    expect(glossary.captions).toBe("subtitle overlay");
    expect(glossary["script"]).toBe("alert(1)");
    expect(Object.keys(glossary).length).toBeGreaterThanOrEqual(2);
  });

  it("merges profile and runtime glossaries with runtime override priority", () => {
    const merged = mergeGlossaries(
      {
        hookforge: "HookForge",
        captions: "subtitles"
      },
      {
        captions: "captions",
        ads: "ads"
      }
    );

    expect(merged.hookforge).toBe("HookForge");
    expect(merged.captions).toBe("captions");
    expect(merged.ads).toBe("ads");
  });

  it("normalizes profile names and exposes default tone", () => {
    expect(normalizeProfileName("  My Team Profile  ")).toBe("My Team Profile");
    expect(DEFAULT_TRANSLATION_TONE).toBe("neutral");
  });
});
