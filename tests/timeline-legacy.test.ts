import { describe, expect, it } from "vitest";
import { applyTimelineOperations, buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";
import type { TimelineOperation } from "@/lib/timeline-types";

describe("timeline legacy operations", () => {
  it("builds initial timeline from assets and serializes config", () => {
    const state = buildTimelineState(
      {},
      [
        { id: "video-1", slotKey: "main", kind: "VIDEO", durationSec: 4 },
        { id: "audio-1", slotKey: "music", kind: "AUDIO", durationSec: 3 }
      ]
    );

    expect(state.tracks.length).toBeGreaterThanOrEqual(2);
    expect(state.revisions.length).toBe(1);

    const serialized = serializeTimelineState({}, state);
    expect(typeof serialized.timelineStateJson).toBe("string");
  });

  it("supports phase-1 operations for clip editing and revision updates", () => {
    const state = buildTimelineState(
      {},
      [{ id: "video-1", slotKey: "main", kind: "VIDEO", durationSec: 4 }]
    );
    const videoTrack = state.tracks.find((entry) => entry.kind === "VIDEO");
    expect(videoTrack).toBeDefined();

    const baseClip = videoTrack!.clips[0];
    expect(baseClip).toBeDefined();

    let operations: TimelineOperation[] = [
      { op: "split_clip", trackId: videoTrack!.id, clipId: baseClip.id, splitMs: baseClip.timelineInMs + 1000 }
    ];
    let applied = applyTimelineOperations(state, operations);
    expect(applied.state.tracks[0].clips.length).toBe(2);

    const firstClip = applied.state.tracks[0].clips[0];
    operations = [
      { op: "set_clip_label", trackId: videoTrack!.id, clipId: firstClip.id, label: "Intro" },
      { op: "move_clip", trackId: videoTrack!.id, clipId: firstClip.id, timelineInMs: 250 },
      { op: "set_clip_timing", trackId: videoTrack!.id, clipId: firstClip.id, timelineInMs: 300, durationMs: 900 },
      { op: "set_transition", trackId: videoTrack!.id, clipId: firstClip.id, transitionType: "crossfade", durationMs: 160 },
      { op: "upsert_effect", trackId: videoTrack!.id, clipId: firstClip.id, effectType: "transform", config: { x: 0.61, y: 0.64 } },
      { op: "merge_clip_with_next", trackId: videoTrack!.id, clipId: firstClip.id }
    ];
    applied = applyTimelineOperations(applied.state, operations);

    expect(applied.state.revisions[0].operations).toHaveLength(6);
    expect(applied.state.tracks[0].clips).toHaveLength(1);
    expect(applied.state.tracks[0].clips[0].label).toBe("Intro");
    expect(applied.state.tracks[0].clips[0].timelineInMs).toBe(300);
    expect(applied.state.tracks[0].clips[0].effects.some((effect) => effect.type === "transform")).toBe(true);
    expect(applied.timelineHash.length).toBeGreaterThan(20);
  });

  it("respects caller-provided track and clip ids for deterministic automation patches", () => {
    const state = buildTimelineState(
      {},
      [{ id: "video-1", slotKey: "main", kind: "VIDEO", durationSec: 4 }]
    );

    const trackId = "track_caption_ai";
    const clipId = "clip_caption_ai_1";

    const applied = applyTimelineOperations(state, [
      {
        op: "create_track",
        trackId,
        kind: "CAPTION",
        name: "AI Captions"
      },
      {
        op: "add_clip",
        clipId,
        trackId,
        label: "HookForge generated this line",
        timelineInMs: 240,
        durationMs: 1100
      }
    ]);

    const createdTrack = applied.state.tracks.find((track) => track.id === trackId);
    expect(createdTrack).toBeDefined();
    expect(createdTrack?.clips[0]?.id).toBe(clipId);
  });
});
