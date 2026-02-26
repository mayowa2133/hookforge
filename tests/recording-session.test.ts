import { describe, expect, it } from "vitest";
import { summarizeRecordingProgress } from "@/lib/recordings/progress";

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
});
