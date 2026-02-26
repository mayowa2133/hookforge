import { buildSegmentWordRanges } from "@/lib/transcript/ranges";

type TranscriptSegmentLike = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerLabel: string | null;
  confidenceAvg: number | null;
};

type TranscriptWordLike = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number | null;
};

export type TranscriptIssueType = "LOW_CONFIDENCE" | "OVERLAP" | "TIMING_DRIFT";

export type TranscriptIssueSeverity = "INFO" | "WARN" | "ERROR";

export type TranscriptIssue = {
  id: string;
  type: TranscriptIssueType;
  severity: TranscriptIssueSeverity;
  segmentId: string;
  startMs: number;
  endMs: number;
  message: string;
  confidenceAvg: number | null;
  speakerLabel: string | null;
};

export function buildTranscriptIssues(params: {
  segments: TranscriptSegmentLike[];
  words: TranscriptWordLike[];
  minConfidence: number;
}) {
  const segments = [...params.segments].sort((a, b) => a.startMs - b.startMs);
  const issues: TranscriptIssue[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (typeof segment.confidenceAvg === "number" && segment.confidenceAvg < params.minConfidence) {
      issues.push({
        id: `low_confidence:${segment.id}`,
        type: "LOW_CONFIDENCE",
        severity: "WARN",
        segmentId: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        message: `Average confidence ${segment.confidenceAvg.toFixed(2)} is below threshold ${params.minConfidence.toFixed(2)}.`,
        confidenceAvg: segment.confidenceAvg,
        speakerLabel: segment.speakerLabel
      });
    }

    const previous = index > 0 ? segments[index - 1] : null;
    if (previous && segment.startMs < previous.endMs) {
      issues.push({
        id: `overlap:${previous.id}:${segment.id}`,
        type: "OVERLAP",
        severity: "ERROR",
        segmentId: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        message: `Segment overlaps previous segment by ${previous.endMs - segment.startMs}ms.`,
        confidenceAvg: segment.confidenceAvg,
        speakerLabel: segment.speakerLabel
      });
    }
  }

  const ranges = buildSegmentWordRanges({
    segments,
    words: params.words
  });
  const words = [...params.words].sort((a, b) => a.startMs - b.startMs);
  for (const range of ranges) {
    const segment = segments.find((entry) => entry.id === range.segmentId);
    if (!segment) {
      continue;
    }
    if (range.startWordIndex === -1 || range.endWordIndex === -1) {
      issues.push({
        id: `timing_drift:no_words:${segment.id}`,
        type: "TIMING_DRIFT",
        severity: "WARN",
        segmentId: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        message: "Segment has no mapped transcript words.",
        confidenceAvg: segment.confidenceAvg,
        speakerLabel: segment.speakerLabel
      });
      continue;
    }

    const firstWord = words[range.startWordIndex];
    const lastWord = words[range.endWordIndex];
    const leadDrift = Math.abs(firstWord.startMs - segment.startMs);
    const tailDrift = Math.abs(lastWord.endMs - segment.endMs);
    if (leadDrift > 250 || tailDrift > 250) {
      issues.push({
        id: `timing_drift:bounds:${segment.id}`,
        type: "TIMING_DRIFT",
        severity: "WARN",
        segmentId: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        message: `Segment timing drift detected (lead ${leadDrift}ms, tail ${tailDrift}ms).`,
        confidenceAvg: segment.confidenceAvg,
        speakerLabel: segment.speakerLabel
      });
    }
  }

  return issues.sort((a, b) => a.startMs - b.startMs);
}
