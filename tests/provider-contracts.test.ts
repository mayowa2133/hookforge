import { describe, expect, it } from "vitest";
import { validateProviderPayload } from "@/lib/providers/contracts";
import { createMockProvider } from "@/lib/providers/mock";

describe("provider contracts", () => {
  it("validates capability payload contracts without stripping unknown fields", () => {
    const asr = validateProviderPayload("asr", {
      language: "en",
      durationMs: 6200,
      diarization: true,
      customHint: "podcast"
    });
    const translation = validateProviderPayload("translation", {
      text: "hello",
      targetLanguage: "es",
      glossary: {
        hookforge: "HookForge"
      },
      projectStyle: "casual"
    });

    expect(asr.language).toBe("en");
    expect(asr.customHint).toBe("podcast");
    expect(translation.targetLanguage).toBe("es");
    expect(translation.projectStyle).toBe("casual");
  });

  it("marks deterministic fallback providers as mock adapters", async () => {
    const provider = createMockProvider("deterministic-fallback", "translation", true);
    const response = await provider.run({
      operation: "CAPTION_TRANSLATE",
      payload: {
        text: "hello world",
        targetLanguage: "de"
      }
    });

    expect(provider.isMock).toBe(true);
    expect(provider.supportsOperations).toEqual(["*"]);
    expect(response.providerName).toBe("deterministic-fallback");
    expect(response.output.accepted).toBe(true);
  });
});

