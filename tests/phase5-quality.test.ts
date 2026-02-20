import { describe, expect, it } from "vitest";
import {
  buildDubbingAdaptationPlan,
  estimateDubbingMos,
  scoreLipSyncAlignment,
  summarizeDubbingQuality
} from "@/lib/ai/phase5-quality";

describe("phase5 quality adaptation and scoring", () => {
  it("builds bounded adaptation plans for lipdub", () => {
    const plan = buildDubbingAdaptationPlan({
      sourceDurationSec: 42,
      sourceLanguage: "en",
      targetLanguage: "es",
      lipDub: true,
      tone: "energetic",
      glossarySize: 24
    });

    expect(plan.targetDurationSec).toBeGreaterThan(36);
    expect(plan.targetDurationSec).toBeLessThan(52);
    expect(plan.tempoRatio).toBeGreaterThan(0.84);
    expect(plan.tempoRatio).toBeLessThan(1.18);
    expect(plan.scriptLengthBudgetChars).toBeGreaterThan(100);
  });

  it("improves lip-sync score on regeneration attempt", () => {
    const plan = buildDubbingAdaptationPlan({
      sourceDurationSec: 95,
      sourceLanguage: "en",
      targetLanguage: "ar",
      lipDub: true,
      tone: "neutral",
      glossarySize: 0
    });

    const first = scoreLipSyncAlignment({
      targetLanguage: "ar",
      durationSec: 95,
      attempt: 0,
      adaptationPlan: plan
    });

    const retry = scoreLipSyncAlignment({
      targetLanguage: "ar",
      durationSec: 95,
      attempt: 1,
      adaptationPlan: plan
    });

    expect(retry.driftMedianMs).toBeLessThan(first.driftMedianMs);
    expect(retry.driftP95Ms).toBeLessThan(first.driftP95Ms);
  });

  it("summarizes mos and lip-sync quality rows", () => {
    const summary = summarizeDubbingQuality([
      {
        language: "es",
        quality: {
          mosEstimate: estimateDubbingMos({
            adaptationPlan: buildDubbingAdaptationPlan({
              sourceDurationSec: 36,
              sourceLanguage: "en",
              targetLanguage: "es",
              lipDub: false,
              tone: "neutral"
            }),
            lipDub: false
          })
        }
      },
      {
        language: "de",
        quality: {
          mosEstimate: 4.3,
          lipSync: {
            driftMedianMs: 58,
            driftP95Ms: 118,
            passed: true
          }
        }
      }
    ]);

    expect(summary.mosAverage).toBeGreaterThanOrEqual(4.2);
    expect(summary.lipSyncMedianMs).toBeLessThanOrEqual(60);
    expect(summary.lipSyncP95Ms).toBeLessThanOrEqual(120);
  });
});
