import { describe, expect, it } from "vitest";
import {
  buildBackgroundOperations,
  buildEyeContactOperations,
  buildMulticamApplyOperations,
  buildMulticamRecommendations,
  buildTimelineOpsFromChatPlan,
  consumeChatUndoEntry,
  consumeChatUndoEntryWithLineage,
  pushChatUndoEntry
} from "@/lib/ai/phase2";
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
      },
      {
        id: "caption-track",
        kind: "CAPTION",
        name: "Caption 1",
        order: 2,
        muted: false,
        volume: 1,
        clips: [
          {
            id: "clip-caption-1",
            label: "Hello creators",
            timelineInMs: 100,
            timelineOutMs: 1400,
            sourceInMs: 0,
            sourceOutMs: 1300,
            effects: []
          }
        ]
      }
    ],
    revisions: []
  };
}

describe("phase2 timeline/chat tools", () => {
  it("maps chat edit intents into timeline operations", () => {
    const operations = buildTimelineOpsFromChatPlan({
      state: makeState(),
      plannedOperations: [
        { op: "split" },
        { op: "trim" },
        { op: "caption_style" },
        { op: "zoom" },
        { op: "audio_duck" }
      ]
    });

    const opNames = operations.map((operation) => operation.op);
    expect(opNames).toContain("split_clip");
    expect(opNames).toContain("trim_clip");
    expect(opNames).toContain("upsert_effect");
    expect(opNames).toContain("set_track_audio");
  });

  it("stores and consumes chat undo entries", () => {
    const startConfig = {};
    const withUndo = pushChatUndoEntry({
      config: startConfig,
      undoToken: "undo-token-1",
      timelineStateJson: "{\"version\":1}",
      prompt: "tighten pacing"
    });

    const consumed = consumeChatUndoEntry(withUndo, "undo-token-1");
    expect(consumed).not.toBeNull();
    expect(consumed?.entry.prompt).toBe("tighten pacing");
    expect(Array.isArray((consumed?.config as Record<string, unknown>).chatEditUndoStack)).toBe(true);
    expect(((consumed?.config as Record<string, unknown>).chatEditUndoStack as unknown[]).length).toBe(0);
  });

  it("enforces strict undo lineage checks", () => {
    const withUndo = pushChatUndoEntry({
      config: {},
      undoToken: "undo-token-2",
      timelineStateJson: "{\"version\":2}",
      prompt: "split intro",
      projectId: "project-1",
      lineage: {
        projectId: "project-1",
        appliedRevision: 3,
        appliedTimelineHash: "hash-3"
      }
    });

    const mismatch = consumeChatUndoEntryWithLineage({
      configInput: withUndo,
      undoToken: "undo-token-2",
      projectId: "project-1",
      currentRevision: 4,
      currentTimelineHash: "hash-4",
      requireLatestLineage: true
    });
    expect("error" in mismatch).toBe(true);

    const valid = consumeChatUndoEntryWithLineage({
      configInput: withUndo,
      undoToken: "undo-token-2",
      projectId: "project-1",
      currentRevision: 3,
      currentTimelineHash: "hash-3",
      requireLatestLineage: true
    });
    expect("error" in valid).toBe(false);
  });

  it("builds eye-contact and background operation plans with quality summaries", () => {
    const eyePlan = buildEyeContactOperations({
      state: makeState(),
      intensity: 0.6,
      gazeTarget: "camera"
    });
    expect(eyePlan.operations.length).toBeGreaterThan(0);
    expect(eyePlan.quality.realismScore).toBeGreaterThan(0.8);
    expect(eyePlan.quality.threshold).toBe(0.86);

    const backgroundPlan = buildBackgroundOperations({
      state: makeState(),
      mode: "replace",
      strength: 0.7
    });
    expect(backgroundPlan.operations.some((operation) => operation.op === "upsert_effect")).toBe(true);
    expect(backgroundPlan.fallbackUsed).toBe(true);
    expect(backgroundPlan.quality.matteStabilityScore).toBeGreaterThan(0.8);
  });

  it("builds multicam recommendations and apply operations from transcript cues", () => {
    const recommendations = buildMulticamRecommendations({
      segments: [
        {
          id: "seg-1",
          startMs: 0,
          endMs: 1500,
          text: "Today we set up the foundation.",
          speakerLabel: "Speaker 1",
          confidenceAvg: 0.92
        },
        {
          id: "seg-2",
          startMs: 1500,
          endMs: 3100,
          text: "But now we need a faster way to switch angles!",
          speakerLabel: "Speaker 2",
          confidenceAvg: 0.91
        },
        {
          id: "seg-3",
          startMs: 3100,
          endMs: 4700,
          text: "Finally we lock in the outro.",
          speakerLabel: "Speaker 1",
          confidenceAvg: 0.89
        }
      ]
    });
    expect(recommendations.length).toBe(3);
    expect(recommendations[0]?.autoSwitchSuggestion).toBeDefined();

    const multicamState: TimelineState = {
      ...makeState(),
      tracks: [
        {
          ...makeState().tracks[0],
          clips: [
            {
              id: "clip-video-1",
              assetId: "asset-video-1",
              slotKey: "main",
              label: "main-1",
              timelineInMs: 0,
              timelineOutMs: 2200,
              sourceInMs: 0,
              sourceOutMs: 2200,
              effects: []
            },
            {
              id: "clip-video-2",
              assetId: "asset-video-2",
              slotKey: "top",
              label: "main-2",
              timelineInMs: 2200,
              timelineOutMs: 4800,
              sourceInMs: 0,
              sourceOutMs: 2600,
              effects: []
            }
          ]
        },
        ...makeState().tracks.slice(1)
      ]
    };

    const applyPlan = buildMulticamApplyOperations({
      state: multicamState,
      strategy: "speaker_change",
      segments: recommendations.map((entry) => ({
        id: entry.segmentId,
        startMs: entry.startMs,
        endMs: entry.endMs,
        text: entry.reason,
        speakerLabel: entry.speakerLabel
      }))
    });
    expect(applyPlan.operations.some((operation) => operation.op === "set_transition")).toBe(true);
    expect(applyPlan.operations.some((operation) => operation.op === "upsert_effect")).toBe(true);
    expect(applyPlan.quality.cutAccuracyScore).toBeGreaterThan(0.8);
  });
});
