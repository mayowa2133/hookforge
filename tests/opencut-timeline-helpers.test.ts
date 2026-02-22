import { describe, expect, it } from "vitest";
import { clampPlaybackSeekSeconds, computeSplitPointMs, computeTrackReorderTarget } from "@/lib/opencut/timeline-helpers";

describe("opencut timeline helpers", () => {
  it("clamps playback seek within bounds", () => {
    expect(clampPlaybackSeekSeconds({ currentSeconds: 4, deltaSeconds: -6, durationSeconds: 12 })).toBe(0);
    expect(clampPlaybackSeekSeconds({ currentSeconds: 4, deltaSeconds: 3, durationSeconds: 12 })).toBe(7);
    expect(clampPlaybackSeekSeconds({ currentSeconds: 11, deltaSeconds: 3, durationSeconds: 12 })).toBe(12);
  });

  it("computes split points with playhead clamping", () => {
    const clip = { timelineInMs: 1000, timelineOutMs: 2200 };
    expect(computeSplitPointMs(clip)).toBe(1600);
    expect(computeSplitPointMs(clip, 900)).toBe(1040);
    expect(computeSplitPointMs(clip, 3000)).toBe(2160);
    expect(computeSplitPointMs(clip, 1800)).toBe(1800);
  });

  it("computes bounded reorder targets", () => {
    expect(computeTrackReorderTarget(0, -1, 3)).toBe(0);
    expect(computeTrackReorderTarget(1, -1, 3)).toBe(0);
    expect(computeTrackReorderTarget(1, 1, 3)).toBe(2);
    expect(computeTrackReorderTarget(2, 1, 3)).toBe(2);
  });
});
