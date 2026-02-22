import { describe, expect, it } from "vitest";
import { evaluateConservativeDeleteRipple } from "@/lib/transcript/ripple-safety";
import type { TimelineState } from "@/lib/timeline-types";

const state: TimelineState = {
  version: 2,
  fps: 30,
  resolution: { width: 1080, height: 1920 },
  exportPreset: "tiktok_9x16",
  tracks: [
    {
      id: "v1",
      kind: "VIDEO",
      name: "Video Track 1",
      order: 0,
      muted: false,
      volume: 1,
      clips: [
        {
          id: "c1",
          timelineInMs: 0,
          timelineOutMs: 3000,
          sourceInMs: 0,
          sourceOutMs: 3000,
          effects: []
        }
      ]
    }
  ],
  revisions: []
};

describe("conservative transcript ripple safety", () => {
  it("returns ripple operations for high-confidence range deletes", () => {
    const result = evaluateConservativeDeleteRipple({
      state,
      startMs: 100,
      endMs: 280,
      minConfidence: 0.86,
      affectedSegments: [{ startMs: 80, endMs: 320, text: "intro", confidenceAvg: 0.94 }]
    });

    expect(result.suggestionsOnly).toBe(false);
    expect(result.safe).toBe(true);
  });

  it("returns suggestions-only for low-confidence segments", () => {
    const result = evaluateConservativeDeleteRipple({
      state,
      startMs: 100,
      endMs: 280,
      minConfidence: 0.86,
      affectedSegments: [{ startMs: 80, endMs: 320, text: "intro", confidenceAvg: 0.72 }]
    });

    expect(result.suggestionsOnly).toBe(true);
    expect(result.issues.some((issue) => issue.code === "RIPPLE_LOW_CONFIDENCE")).toBe(true);
  });
});
