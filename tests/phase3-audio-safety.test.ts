import { describe, expect, it } from "vitest";
import { classifyEnhancementSafetyMode, classifyFillerSafetyMode } from "@/lib/audio/phase3-tools";

const baseAnalysis = {
  timelineDurationMs: 6000,
  audioTrackCount: 1,
  audioClipCount: 1,
  transcriptWordCount: 120,
  averageTrackVolume: 1,
  averageTranscriptConfidence: 0.93,
  estimatedNoiseLevel: 0.08,
  estimatedLoudnessLufs: -15,
  fillerCandidateCount: 6,
  recommendedPreset: "dialogue_enhance" as const,
  readyForApply: true
};

describe("phase3 audio safety", () => {
  it("classifies enhancement as auto apply when confidence is strong", () => {
    const classified = classifyEnhancementSafetyMode({
      analysis: baseAnalysis,
      issues: [],
      profile: {
        preset: "dialogue_enhance",
        denoise: true,
        clarity: true,
        deEsser: true,
        normalizeLoudness: true,
        bypassEnhancement: false,
        soloPreview: false,
        targetLufs: -14,
        intensity: 1,
        trackVolumeScale: 1.02,
        compressionRatio: 2.4,
        eqPresence: 2.8,
        denoiseStrength: 0.5,
        deEsserStrength: 0.4
      }
    });

    expect(classified.safetyMode).toBe("AUTO_APPLY");
    expect(classified.rationale.confidenceScore).toBeGreaterThan(0.9);
  });

  it("requires confirm for large filler batch and blocks low confidence", () => {
    const confirm = classifyFillerSafetyMode({
      analysis: baseAnalysis,
      candidates: Array.from({ length: 30 }, (_, index) => ({
        id: `c${index}`,
        segmentId: "s1",
        wordId: `w${index}`,
        startMs: index * 50,
        endMs: index * 50 + 30,
        text: "um",
        confidence: 0.82,
        reason: "TOKEN" as const,
        wordIds: [`w${index}`]
      })),
      issues: []
    });
    expect(confirm.safetyMode).toBe("APPLY_WITH_CONFIRM");

    const blocked = classifyFillerSafetyMode({
      analysis: { ...baseAnalysis, averageTranscriptConfidence: 0.65 },
      candidates: [
        {
          id: "low",
          segmentId: "s1",
          wordId: "w1",
          startMs: 0,
          endMs: 30,
          text: "um",
          confidence: 0.62,
          reason: "TOKEN",
          wordIds: ["w1"]
        }
      ],
      issues: []
    });
    expect(blocked.safetyMode).toBe("PREVIEW_ONLY");
  });
});
