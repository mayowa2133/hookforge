import { describe, expect, it } from "vitest";
import { previewTimelineOperationsWithValidation, validateTimelineStateInvariants } from "@/lib/timeline-invariants";
import type { TimelineOperation, TimelineState } from "@/lib/timeline-types";

function makeState(): TimelineState {
  return {
    version: 1,
    fps: 30,
    resolution: { width: 1080, height: 1920 },
    exportPreset: "tiktok_9x16",
    tracks: [
      {
        id: "video-track",
        kind: "VIDEO",
        name: "Video 1",
        order: 0,
        muted: false,
        volume: 1,
        clips: [
          {
            id: "clip-1",
            timelineInMs: 0,
            timelineOutMs: 1200,
            sourceInMs: 0,
            sourceOutMs: 1200,
            effects: []
          }
        ]
      }
    ],
    revisions: [
      {
        id: "rev-1",
        revision: 1,
        createdAt: new Date().toISOString(),
        timelineHash: "hash-1",
        operations: []
      }
    ]
  };
}

describe("timeline invariant validation", () => {
  it("flags invalid clip timing", () => {
    const state = makeState();
    state.tracks[0].clips[0].timelineOutMs = 0;

    const issues = validateTimelineStateInvariants(state);
    expect(issues.some((issue) => issue.code === "CLIP_TIMELINE_OUT_INVALID")).toBe(true);
  });

  it("fails preview when operation references missing track", () => {
    const operations: TimelineOperation[] = [
      {
        op: "add_clip",
        trackId: "missing-track",
        timelineInMs: 0,
        durationMs: 1000
      }
    ];

    const preview = previewTimelineOperationsWithValidation({
      state: makeState(),
      operations
    });

    expect(preview.valid).toBe(false);
    expect(preview.issues[0]?.code).toBe("APPLY_FAILED");
  });
});
