import { describe, expect, it } from "vitest";
import { buildSegmentWordRanges, resolveTranscriptRangeSelection } from "@/lib/transcript/ranges";

describe("transcript ranges helpers", () => {
  it("resolves range selection to bounded word window", () => {
    const words = [
      { id: "w1", text: "hello", startMs: 0, endMs: 100 },
      { id: "w2", text: "there", startMs: 100, endMs: 220 },
      { id: "w3", text: "friend", startMs: 220, endMs: 360 }
    ];
    const resolved = resolveTranscriptRangeSelection(words, {
      startWordIndex: -10,
      endWordIndex: 99
    });

    expect(resolved?.startWordIndex).toBe(0);
    expect(resolved?.endWordIndex).toBe(2);
    expect(resolved?.startMs).toBe(0);
    expect(resolved?.endMs).toBe(360);
    expect(resolved?.wordCount).toBe(3);
  });

  it("builds segment word index ranges with unmapped segment fallback", () => {
    const segments = [
      { id: "s1", text: "one two", startMs: 0, endMs: 220, speakerLabel: null, confidenceAvg: 0.9 },
      { id: "s2", text: "silent", startMs: 500, endMs: 700, speakerLabel: null, confidenceAvg: 0.7 }
    ];
    const words = [
      { id: "w1", text: "one", startMs: 0, endMs: 100 },
      { id: "w2", text: "two", startMs: 110, endMs: 210 }
    ];

    const ranges = buildSegmentWordRanges({ segments, words });
    expect(ranges).toHaveLength(2);
    expect(ranges[0].startWordIndex).toBe(0);
    expect(ranges[0].endWordIndex).toBe(1);
    expect(ranges[1].startWordIndex).toBe(-1);
    expect(ranges[1].endWordIndex).toBe(-1);
  });
});
