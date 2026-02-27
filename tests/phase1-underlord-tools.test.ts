import { describe, expect, it } from "vitest";
import type { TimelineState } from "@/lib/timeline-types";
import { resolveAutopilotPrompt, UNDERLORD_COMMAND_CATALOG } from "@/lib/autopilot-tools";
import { runChatEditPlannerValidatorExecutor } from "@/lib/ai/chat-edit-pipeline";
import { buildTimelineOpsFromChatPlan } from "@/lib/ai/phase2";

function buildState(): TimelineState {
  return {
    version: 1,
    fps: 30,
    resolution: { width: 1080, height: 1920 },
    exportPreset: "tiktok_9x16",
    tracks: [
      {
        id: "video-track-1",
        kind: "VIDEO",
        name: "Video 1",
        order: 0,
        muted: false,
        volume: 1,
        clips: [
          {
            id: "video-clip-1",
            assetId: "asset-video-1",
            slotKey: "main",
            label: "Main",
            timelineInMs: 0,
            timelineOutMs: 4200,
            sourceInMs: 0,
            sourceOutMs: 4200,
            effects: []
          }
        ]
      },
      {
        id: "audio-track-1",
        kind: "AUDIO",
        name: "Audio 1",
        order: 1,
        muted: false,
        volume: 1,
        clips: [
          {
            id: "audio-clip-1",
            assetId: "asset-audio-1",
            slotKey: "music",
            label: "Music",
            timelineInMs: 0,
            timelineOutMs: 4200,
            sourceInMs: 0,
            sourceOutMs: 4200,
            effects: []
          }
        ]
      }
    ],
    revisions: [
      {
        id: "rev-1",
        revision: 1,
        createdAt: new Date("2026-02-26T00:00:00.000Z").toISOString(),
        timelineHash: "rev-1-hash",
        operations: []
      }
    ]
  };
}

describe("phase1 underlord command families", () => {
  it("produces deterministic planned operations for each command family", () => {
    const state = buildState();

    for (const family of UNDERLORD_COMMAND_CATALOG) {
      const resolved = resolveAutopilotPrompt({
        commandFamily: family.id
      });
      const pipeline = runChatEditPlannerValidatorExecutor({
        prompt: resolved.resolvedPrompt,
        state
      });

      expect(pipeline.validatedOperations.length, `expected operations for ${family.id}`).toBeGreaterThan(0);
      expect(
        pipeline.validatedOperations.some((operation) => operation.op === "generic"),
        `did not expect generic fallback for ${family.id}`
      ).toBe(false);
      const timelineOps = buildTimelineOpsFromChatPlan({
        state,
        plannedOperations: pipeline.validatedOperations
      });
      expect(timelineOps.length, `expected deterministic timeline ops for ${family.id}`).toBeGreaterThan(0);
    }
  });
});

