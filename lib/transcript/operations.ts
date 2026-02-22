import { randomUUID } from "crypto";
import { sanitizeOverlayText } from "@/lib/sanitize";
import type { TimelineOperation, TimelineState } from "@/lib/timeline-types";
import type { TranscriptSegmentLike, TranscriptWordLike } from "@/lib/transcript/segmentation";
import { evaluateConservativeDeleteRipple, type TranscriptPatchIssue } from "@/lib/transcript/ripple-safety";

export type TranscriptPatchOperation =
  | {
      op: "replace_text";
      segmentId: string;
      text: string;
    }
  | {
      op: "split_segment";
      segmentId: string;
      splitMs: number;
    }
  | {
      op: "merge_segments";
      firstSegmentId: string;
      secondSegmentId: string;
    }
  | {
      op: "delete_range";
      startMs: number;
      endMs: number;
    }
  | {
      op: "set_speaker";
      segmentId: string;
      speakerLabel: string | null;
    }
  | {
      op: "normalize_punctuation";
      segmentIds?: string[];
    };

export type TranscriptPatchResult = {
  nextSegments: Array<TranscriptSegmentLike & { id: string }>;
  nextWords: TranscriptWordLike[];
  issues: TranscriptPatchIssue[];
  timelineOperations: TimelineOperation[];
  suggestionsOnly: boolean;
};

function upsertPunctuation(input: string) {
  const safe = sanitizeOverlayText(input, "caption");
  if (!safe) {
    return "";
  }
  if (/[.!?]$/.test(safe)) {
    return safe;
  }
  return `${safe}.`;
}

function findSegment(segments: Array<TranscriptSegmentLike & { id: string }>, segmentId: string) {
  return segments.find((segment) => segment.id === segmentId) ?? null;
}

function clipDurationMs(segment: TranscriptSegmentLike) {
  return Math.max(120, segment.endMs - segment.startMs);
}

function ensureCaptionTrack(state: TimelineState, language: string) {
  const name = `Auto captions (${language})`.toLowerCase();
  const existing = state.tracks.find((track) => track.kind === "CAPTION" && track.name.toLowerCase() === name);
  if (existing) {
    return { id: existing.id, createOps: [] as TimelineOperation[] };
  }

  const trackId = randomUUID();
  return {
    id: trackId,
    createOps: [
      {
        op: "create_track",
        trackId,
        kind: "CAPTION",
        name: `Auto captions (${language})`
      } as TimelineOperation
    ]
  };
}

export function buildCaptionTrackReplacementOps(params: {
  state: TimelineState;
  language: string;
  segments: Array<TranscriptSegmentLike & { id: string }>;
}) {
  const trackInfo = ensureCaptionTrack(params.state, params.language);
  const existing = params.state.tracks.find((track) => track.id === trackInfo.id);
  const operations: TimelineOperation[] = [...trackInfo.createOps];

  if (existing) {
    for (const clip of existing.clips) {
      operations.push({
        op: "remove_clip",
        trackId: existing.id,
        clipId: clip.id
      });
    }
  }

  for (const segment of params.segments) {
    const clipId = randomUUID();
    operations.push({
      op: "add_clip",
      clipId,
      trackId: trackInfo.id,
      label: sanitizeOverlayText(segment.text, "caption"),
      timelineInMs: segment.startMs,
      durationMs: clipDurationMs(segment),
      sourceInMs: 0,
      sourceOutMs: clipDurationMs(segment)
    });
    operations.push({
      op: "upsert_effect",
      trackId: trackInfo.id,
      clipId,
      effectType: "caption_style",
      config: {
        fontSize: 42,
        bgOpacity: 0.72,
        radius: 16
      }
    });
  }

  return operations;
}

function rebuildWordsFromSegments(segments: Array<TranscriptSegmentLike & { id: string }>) {
  const words: TranscriptWordLike[] = [];
  for (const segment of segments) {
    const tokens = sanitizeOverlayText(segment.text, "caption").split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      continue;
    }
    const duration = Math.max(120, segment.endMs - segment.startMs);
    const slot = Math.max(80, Math.floor(duration / tokens.length));
    let cursor = segment.startMs;
    for (const token of tokens) {
      const end = Math.min(segment.endMs, cursor + slot);
      words.push({
        startMs: cursor,
        endMs: Math.max(cursor + 60, end),
        text: token,
        speakerLabel: segment.speakerLabel ?? null,
        confidence: segment.confidenceAvg ?? null
      });
      cursor = end;
    }
  }
  return words;
}

export function applyTranscriptPatchOperations(params: {
  state: TimelineState;
  language: string;
  segments: Array<TranscriptSegmentLike & { id: string }>;
  operations: TranscriptPatchOperation[];
  minConfidenceForRipple: number;
}): TranscriptPatchResult {
  let nextSegments = [...params.segments].sort((a, b) => a.startMs - b.startMs);
  let timelineOperations: TimelineOperation[] = [];
  const issues: TranscriptPatchIssue[] = [];
  let suggestionsOnly = false;

  for (const operation of params.operations) {
    if (operation.op === "replace_text") {
      const segment = findSegment(nextSegments, operation.segmentId);
      if (!segment) {
        issues.push({
          code: "SEGMENT_NOT_FOUND",
          message: `Segment not found: ${operation.segmentId}`,
          severity: "ERROR"
        });
        continue;
      }
      segment.text = sanitizeOverlayText(operation.text, "caption");
      if (!segment.text) {
        issues.push({
          code: "SEGMENT_TEXT_EMPTY",
          message: `Segment text would become empty: ${operation.segmentId}`,
          severity: "ERROR"
        });
      }
      continue;
    }

    if (operation.op === "split_segment") {
      const segment = findSegment(nextSegments, operation.segmentId);
      if (!segment) {
        issues.push({
          code: "SEGMENT_NOT_FOUND",
          message: `Segment not found: ${operation.segmentId}`,
          severity: "ERROR"
        });
        continue;
      }

      const splitAt = Math.max(segment.startMs + 80, Math.min(operation.splitMs, segment.endMs - 80));
      if (splitAt <= segment.startMs || splitAt >= segment.endMs) {
        issues.push({
          code: "SEGMENT_SPLIT_INVALID",
          message: "Split point must be within segment bounds.",
          severity: "ERROR"
        });
        continue;
      }
      const originalEnd = segment.endMs;
      const tokens = sanitizeOverlayText(segment.text, "caption").split(/\s+/).filter(Boolean);
      const midpoint = Math.max(1, Math.floor(tokens.length / 2));
      const leftText = tokens.slice(0, midpoint).join(" ");
      const rightText = tokens.slice(midpoint).join(" ");
      segment.endMs = splitAt;
      segment.text = leftText;
      nextSegments.push({
        id: randomUUID(),
        startMs: splitAt,
        endMs: Math.max(splitAt + 80, originalEnd),
        text: rightText || leftText,
        speakerLabel: segment.speakerLabel ?? null,
        confidenceAvg: segment.confidenceAvg ?? null
      });
      nextSegments = nextSegments.sort((a, b) => a.startMs - b.startMs);
      continue;
    }

    if (operation.op === "merge_segments") {
      const first = findSegment(nextSegments, operation.firstSegmentId);
      const second = findSegment(nextSegments, operation.secondSegmentId);
      if (!first || !second) {
        issues.push({
          code: "SEGMENT_NOT_FOUND",
          message: "Both segments must exist to merge.",
          severity: "ERROR"
        });
        continue;
      }
      const ordered = [first, second].sort((a, b) => a.startMs - b.startMs);
      ordered[0].startMs = Math.min(ordered[0].startMs, ordered[1].startMs);
      ordered[0].endMs = Math.max(ordered[0].endMs, ordered[1].endMs);
      ordered[0].text = sanitizeOverlayText(`${ordered[0].text} ${ordered[1].text}`, "caption");
      nextSegments = nextSegments.filter((segment) => segment.id !== ordered[1].id);
      continue;
    }

    if (operation.op === "delete_range") {
      const startMs = Math.max(0, Math.floor(operation.startMs));
      const endMs = Math.max(startMs + 80, Math.floor(operation.endMs));
      const affected = nextSegments.filter((segment) => segment.startMs < endMs && segment.endMs > startMs);
      if (affected.length === 0) {
        continue;
      }
      const ripple = evaluateConservativeDeleteRipple({
        state: params.state,
        startMs,
        endMs,
        affectedSegments: affected,
        minConfidence: params.minConfidenceForRipple
      });
      issues.push(...ripple.issues);
      if (ripple.suggestionsOnly) {
        suggestionsOnly = true;
      } else {
        timelineOperations = timelineOperations.concat(ripple.timelineOperations);
      }
      nextSegments = nextSegments.filter((segment) => !(segment.startMs < endMs && segment.endMs > startMs));
      continue;
    }

    if (operation.op === "set_speaker") {
      const segment = findSegment(nextSegments, operation.segmentId);
      if (!segment) {
        issues.push({
          code: "SEGMENT_NOT_FOUND",
          message: `Segment not found: ${operation.segmentId}`,
          severity: "ERROR"
        });
        continue;
      }
      segment.speakerLabel = operation.speakerLabel ? sanitizeOverlayText(operation.speakerLabel, "caption") : null;
      continue;
    }

    if (operation.op === "normalize_punctuation") {
      const targetIds = new Set(operation.segmentIds ?? []);
      nextSegments = nextSegments.map((segment) => {
        if (targetIds.size > 0 && !targetIds.has(segment.id)) {
          return segment;
        }
        return {
          ...segment,
          text: upsertPunctuation(segment.text)
        };
      });
    }
  }

  const hardErrors = issues.filter((issue) => issue.severity === "ERROR");
  if (hardErrors.length > 0) {
    return {
      nextSegments: params.segments,
      nextWords: rebuildWordsFromSegments(params.segments),
      issues,
      timelineOperations: [],
      suggestionsOnly: true
    };
  }

  nextSegments = nextSegments
    .filter((segment) => sanitizeOverlayText(segment.text, "caption").length > 0)
    .sort((a, b) => a.startMs - b.startMs)
    .map((segment) => ({
      ...segment,
      startMs: Math.max(0, Math.floor(segment.startMs)),
      endMs: Math.max(Math.floor(segment.startMs) + 80, Math.floor(segment.endMs)),
      text: sanitizeOverlayText(segment.text, "caption")
    }));

  const captionOps = buildCaptionTrackReplacementOps({
    state: params.state,
    language: params.language,
    segments: nextSegments
  });

  return {
    nextSegments,
    nextWords: rebuildWordsFromSegments(nextSegments),
    issues,
    timelineOperations: suggestionsOnly ? captionOps : [...timelineOperations, ...captionOps],
    suggestionsOnly
  };
}

export function summarizeTranscriptQuality(params: {
  words: TranscriptWordLike[];
  segments: TranscriptSegmentLike[];
}) {
  const confidenceValues = params.words
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === "number");

  const averageConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;

  return {
    wordCount: params.words.length,
    segmentCount: params.segments.length,
    averageConfidence: Number(averageConfidence.toFixed(4))
  };
}
