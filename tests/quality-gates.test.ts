import { describe, expect, it } from "vitest";
import { buildDefaultMetricsForCapability, evaluateQualityGate } from "@/lib/quality/gates";

describe("quality gate evaluator", () => {
  it("passes default ASR metrics against gates", () => {
    const metrics = buildDefaultMetricsForCapability("asr");
    const result = evaluateQualityGate({ capability: "asr", metrics });

    expect(result.capability).toBe("asr");
    expect(result.passed).toBe(true);
    expect(result.reasons.length).toBe(0);
  });

  it("fails chat edit gate when undo correctness drops below target", () => {
    const result = evaluateQualityGate({
      capability: "chat_edit",
      metrics: {
        successRate: 99,
        latencyP95Ms: 2000,
        validPlanRate: 99,
        undoCorrectnessRate: 90
      }
    });

    expect(result.passed).toBe(false);
    expect(result.reasons.some((reason) => reason.toLowerCase().includes("undo"))).toBe(true);
  });

  it("normalizes capability aliases", () => {
    const result = evaluateQualityGate({
      capability: "Lip Sync",
      metrics: {
        successRate: 98,
        latencyP95Ms: 2000,
        lipSyncMedianMs: 55,
        lipSyncP95Ms: 100
      }
    });

    expect(result.capability).toBe("lipsync");
    expect(result.passed).toBe(true);
  });
});
