import { describe, expect, it } from "vitest";
import { runChatEditPlannerValidatorExecutor } from "@/lib/ai/chat-edit-pipeline";
import type { TimelineState } from "@/lib/timeline-types";

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
            id: "clip-video-1",
            assetId: "asset-video-1",
            slotKey: "main",
            label: "main",
            timelineInMs: 0,
            timelineOutMs: 3000,
            sourceInMs: 0,
            sourceOutMs: 3000,
            effects: []
          }
        ]
      },
      {
        id: "audio-track",
        kind: "AUDIO",
        name: "Audio 1",
        order: 1,
        muted: false,
        volume: 1,
        clips: []
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

describe("chat edit planner-validator-executor", () => {
  it("applies deterministic plan when confidence is high", () => {
    const result = runChatEditPlannerValidatorExecutor({
      prompt: "split the intro and trim pauses",
      state: makeState()
    });

    expect(result.executionMode).toBe("APPLIED");
    expect(result.planValidation.isValid).toBe(true);
    expect(result.appliedTimelineOperations.length).toBeGreaterThan(0);
    expect(result.nextState?.version).toBe(2);
  });

  it("falls back to constrained suggestions when confidence is low", () => {
    const result = runChatEditPlannerValidatorExecutor({
      prompt: "make it magical",
      state: makeState()
    });

    expect(result.executionMode).toBe("SUGGESTIONS_ONLY");
    expect(result.planValidation.isValid).toBe(false);
    expect(result.constrainedSuggestions.length).toBeGreaterThan(0);
    expect(result.appliedTimelineOperations).toHaveLength(0);
    expect(result.fallbackReason).toBeTruthy();
  });
});
