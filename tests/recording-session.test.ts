import { describe, expect, it } from "vitest";
import { buildDeterministicRecordingRecoveryPlan, summarizeRecordingProgress } from "@/lib/recordings/progress";

describe("recording session helpers", () => {
  it("computes recording progress and missing parts deterministically", () => {
    const progress = summarizeRecordingProgress(5, [
      { partNumber: 3 },
      { partNumber: 1 },
      { partNumber: 3 }
    ]);

    expect(progress.totalParts).toBe(5);
    expect(progress.completedParts).toBe(2);
    expect(progress.remainingParts).toBe(3);
    expect(progress.uploadedPartNumbers).toEqual([1, 3]);
    expect(progress.missingPartNumbers).toEqual([2, 4, 5]);
    expect(progress.progressPct).toBe(40);
  });

  it("returns fully complete state when all parts are present", () => {
    const progress = summarizeRecordingProgress(3, [
      { partNumber: 1 },
      { partNumber: 2 },
      { partNumber: 3 }
    ]);

    expect(progress.completedParts).toBe(3);
    expect(progress.remainingParts).toBe(0);
    expect(progress.progressPct).toBe(100);
    expect(progress.missingPartNumbers).toEqual([]);
  });

  it("builds deterministic recovery plan with conflict repair actions", () => {
    const plan = buildDeterministicRecordingRecoveryPlan({
      totalParts: 4,
      chunks: [
        { partNumber: 1, eTag: "etag-1", checksumSha256: "a".repeat(64) },
        { partNumber: 2, eTag: "etag-2", checksumSha256: "b".repeat(64) },
        { partNumber: 2, eTag: "etag-2b", checksumSha256: "c".repeat(64) }
      ]
    });

    expect(plan.ranges).toEqual([{ startPart: 1, endPart: 2 }]);
    expect(plan.conflicts.some((conflict) => conflict.code === "MISSING_PARTS")).toBe(true);
    expect(plan.conflicts.some((conflict) => conflict.code === "CHECKSUM_MISMATCH")).toBe(true);
    expect(plan.expectedRecoveryState).toBe("REQUIRES_REPAIR");
    expect(plan.repairActions.length).toBeGreaterThan(0);
  });
});
