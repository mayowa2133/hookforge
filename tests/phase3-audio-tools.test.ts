import { describe, expect, it } from "vitest";
import { buildAudioEnhancementTimelineOperations, detectFillerCandidates } from "@/lib/audio/phase3-tools";
import type { TimelineState } from "@/lib/timeline-types";

function makeTimelineState(): TimelineState {
  return {
    version: 1,
    fps: 30,
    resolution: { width: 1080, height: 1920 },
    exportPreset: "tiktok_9x16",
    tracks: [
      {
        id: "audio-track-1",
        kind: "AUDIO",
        name: "Audio 1",
        order: 0,
        muted: false,
        volume: 1,
        clips: [
          {
            id: "audio-clip-1",
            assetId: "asset-a1",
            slotKey: "main",
            label: "Main audio",
            timelineInMs: 0,
            timelineOutMs: 4200,
            sourceInMs: 0,
            sourceOutMs: 4200,
            effects: []
          }
        ]
      }
    ],
    revisions: []
  };
}

describe("phase3 audio quality tools", () => {
  it("builds audio enhancement timeline ops for audio tracks", () => {
    const built = buildAudioEnhancementTimelineOperations(makeTimelineState(), {
      preset: "dialogue_enhance",
      denoise: true,
      clarity: true,
      normalizeLoudness: true,
      targetLufs: -14,
      intensity: 1,
      trackVolumeScale: 1.02,
      compressionRatio: 2.5,
      eqPresence: 2.8,
      denoiseStrength: 0.7
    });

    expect(built.issues).toHaveLength(0);
    expect(built.operations.some((operation) => operation.op === "set_track_audio")).toBe(true);
    expect(built.operations.some((operation) => operation.op === "upsert_effect")).toBe(true);
  });

  it("detects filler candidates from tokens and bigrams", () => {
    const candidates = detectFillerCandidates({
      words: [
        { id: "w1", segmentId: "s1", text: "um", startMs: 0, endMs: 120, confidence: 0.6 },
        { id: "w2", segmentId: "s1", text: "you", startMs: 200, endMs: 260, confidence: 0.7 },
        { id: "w3", segmentId: "s1", text: "know", startMs: 270, endMs: 340, confidence: 0.7 },
        { id: "w4", segmentId: "s2", text: "shipping", startMs: 400, endMs: 620, confidence: 0.95 }
      ],
      segments: [
        { id: "s1", startMs: 0, endMs: 360 },
        { id: "s2", startMs: 360, endMs: 800 }
      ],
      maxCandidates: 10,
      maxConfidence: 0.9
    });

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.some((candidate) => candidate.reason === "TOKEN")).toBe(true);
    expect(candidates.some((candidate) => candidate.reason === "BIGRAM")).toBe(true);
  });
});
