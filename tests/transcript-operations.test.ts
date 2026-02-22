import { describe, expect, it } from "vitest";
import { applyTranscriptPatchOperations } from "@/lib/transcript/operations";
import type { TimelineState } from "@/lib/timeline-types";

function makeState(): TimelineState {
  return {
    version: 2,
    fps: 30,
    resolution: { width: 1080, height: 1920 },
    exportPreset: "tiktok_9x16",
    tracks: [
      {
        id: "video-main",
        kind: "VIDEO",
        name: "Video Track 1",
        order: 0,
        muted: false,
        volume: 1,
        clips: [
          {
            id: "clip-main-1",
            assetId: "asset-main",
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
        id: "caption-track-en",
        kind: "CAPTION",
        name: "Auto captions (en)",
        order: 1,
        muted: false,
        volume: 1,
        clips: []
      }
    ],
    revisions: []
  };
}

describe("transcript patch operations", () => {
  it("applies replace+split operations and emits caption rebuild ops", () => {
    const result = applyTranscriptPatchOperations({
      state: makeState(),
      language: "en",
      minConfidenceForRipple: 0.86,
      segments: [
        {
          id: "s1",
          startMs: 0,
          endMs: 1000,
          text: "hello creators this is hookforge",
          confidenceAvg: 0.93
        }
      ],
      operations: [
        { op: "replace_text", segmentId: "s1", text: "hello creators this is a stronger hook" },
        { op: "split_segment", segmentId: "s1", splitMs: 500 },
        { op: "normalize_punctuation" }
      ]
    });

    expect(result.suggestionsOnly).toBe(false);
    expect(result.nextSegments.length).toBe(2);
    expect(result.timelineOperations.some((op) => op.op === "add_clip")).toBe(true);
    expect(result.timelineOperations.some((op) => op.op === "upsert_effect")).toBe(true);
  });

  it("falls back to suggestions-only when delete range confidence is too low", () => {
    const result = applyTranscriptPatchOperations({
      state: makeState(),
      language: "en",
      minConfidenceForRipple: 0.95,
      segments: [
        {
          id: "s1",
          startMs: 100,
          endMs: 900,
          text: "delete this intro range",
          confidenceAvg: 0.8
        }
      ],
      operations: [{ op: "delete_range", startMs: 120, endMs: 300 }]
    });

    expect(result.suggestionsOnly).toBe(true);
    expect(result.issues.some((issue) => issue.code === "RIPPLE_LOW_CONFIDENCE")).toBe(true);
  });
});
