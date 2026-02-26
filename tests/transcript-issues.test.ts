import { describe, expect, it } from "vitest";
import { buildTranscriptIssues } from "@/lib/transcript/issues";

describe("transcript issues helpers", () => {
  it("detects low confidence, overlap, and timing drift issues", () => {
    const segments = [
      { id: "s1", text: "hello there", startMs: 0, endMs: 300, speakerLabel: "A", confidenceAvg: 0.7 },
      { id: "s2", text: "overlap", startMs: 250, endMs: 500, speakerLabel: "B", confidenceAvg: 0.95 },
      { id: "s3", text: "drift", startMs: 700, endMs: 900, speakerLabel: null, confidenceAvg: 0.9 }
    ];
    const words = [
      { id: "w1", text: "hello", startMs: 0, endMs: 120, confidence: 0.8 },
      { id: "w2", text: "there", startMs: 120, endMs: 260, confidence: 0.8 },
      { id: "w3", text: "overlap", startMs: 260, endMs: 490, confidence: 0.95 }
    ];

    const issues = buildTranscriptIssues({
      segments,
      words,
      minConfidence: 0.86
    });

    expect(issues.some((issue) => issue.type === "LOW_CONFIDENCE" && issue.segmentId === "s1")).toBe(true);
    expect(issues.some((issue) => issue.type === "OVERLAP" && issue.segmentId === "s2")).toBe(true);
    expect(issues.some((issue) => issue.type === "TIMING_DRIFT" && issue.segmentId === "s3")).toBe(true);
  });
});
