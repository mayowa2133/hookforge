import { describe, expect, it } from "vitest";
import { assignSegmentIdsToWords, buildTranscriptSegmentsFromWords } from "@/lib/transcript/segmentation";

describe("transcript segmentation helpers", () => {
  it("builds bounded transcript segments from words", () => {
    const words = Array.from({ length: 14 }, (_, index) => ({
      id: `w${index + 1}`,
      startMs: index * 120,
      endMs: index * 120 + 110,
      text: `token${index + 1}`,
      confidence: 0.91
    }));

    const segments = buildTranscriptSegmentsFromWords(words, {
      maxWordsPerSegment: 5,
      maxCharsPerLine: 20,
      maxLinesPerSegment: 2
    });

    expect(segments.length).toBeGreaterThan(2);
    expect(segments[0].startMs).toBe(0);
    expect(segments.at(-1)?.endMs).toBeGreaterThan(segments[0].endMs);
  });

  it("assigns segment ids to overlapping words", () => {
    const words = [
      { id: "w1", startMs: 0, endMs: 100, text: "hello", confidence: 0.9 },
      { id: "w2", startMs: 120, endMs: 220, text: "world", confidence: 0.9 }
    ];
    const segments = [
      { id: "s1", startMs: 0, endMs: 150, text: "hello", confidenceAvg: 0.9 },
      { id: "s2", startMs: 151, endMs: 260, text: "world", confidenceAvg: 0.9 }
    ];

    const linked = assignSegmentIdsToWords(words, segments);
    expect(linked[0].segmentId).toBe("s1");
    expect(linked[1].segmentId).toBe("s2");
  });
});
