import { describe, expect, it } from "vitest";
import { buildEchoSampleStorageKey, estimatePhase3Credits, nextConsentStatus } from "@/lib/ai/phase3";
import { rankCreatorCandidates } from "@/lib/ai/phase4-quality";

describe("phase3 creator tools", () => {
  it("marks consent status from verification boolean", () => {
    expect(nextConsentStatus(true)).toBe("VERIFIED");
    expect(nextConsentStatus(false)).toBe("PENDING");
  });

  it("estimates creator credits with twin/voice modifiers", () => {
    const base = estimatePhase3Credits({
      durationSec: 20,
      withTwin: false,
      withVoice: false,
      hasAudioInput: false
    });

    const withTwinAndVoice = estimatePhase3Credits({
      durationSec: 20,
      withTwin: true,
      withVoice: true,
      hasAudioInput: false
    });

    const withAudioInput = estimatePhase3Credits({
      durationSec: 20,
      withTwin: false,
      withVoice: true,
      hasAudioInput: true
    });

    expect(base).toBeGreaterThanOrEqual(40);
    expect(withTwinAndVoice).toBeGreaterThan(base);
    expect(withAudioInput).toBeLessThan(withTwinAndVoice);
  });

  it("builds echo sample keys under voice-samples namespace", () => {
    const key = buildEchoSampleStorageKey("workspace_123", ".webm");
    expect(key.startsWith("voice-samples/workspace_123/")).toBe(true);
    expect(key.endsWith(".webm")).toBe(true);
  });

  it("ranks creator actor candidates and computes uplift", () => {
    const ranked = rankCreatorCandidates({
      script: "Hook quickly, share proof, then close with CTA.",
      durationSec: 24,
      requestedActorId: "demo-host-studio",
      actors: [
        { id: "demo-host-studio", name: "Studio Host", description: "Clean explainer tone with center framing." },
        { id: "demo-host-hype", name: "Hype Host", description: "Punchier delivery with high-contrast backdrop." },
        { id: "demo-host-calm", name: "Calm Narrator", description: "Low-noise look for educational explainers." }
      ]
    });

    expect(ranked.candidates.length).toBe(3);
    expect(ranked.selected.actorId).toBe("demo-host-studio");
    expect(ranked.qualitySummary.ratingScore).toBeGreaterThanOrEqual(4.2);
    expect(ranked.qualitySummary.candidateUpliftPct).toBeGreaterThan(0);
  });
});
