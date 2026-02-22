import type { TimelineOperation, TimelineState } from "@/lib/timeline-types";
import type { TranscriptSegmentLike } from "@/lib/transcript/segmentation";

export type TranscriptPatchIssue = {
  code: string;
  message: string;
  severity: "INFO" | "WARN" | "ERROR";
};

export type ConservativeRippleEvaluation = {
  safe: boolean;
  suggestionsOnly: boolean;
  issues: TranscriptPatchIssue[];
  timelineOperations: TimelineOperation[];
};

function primaryVideoTrack(state: TimelineState) {
  return [...state.tracks]
    .filter((track) => track.kind === "VIDEO")
    .sort((a, b) => a.order - b.order)[0] ?? null;
}

export function evaluateConservativeDeleteRipple(params: {
  state: TimelineState;
  startMs: number;
  endMs: number;
  affectedSegments: TranscriptSegmentLike[];
  minConfidence: number;
}): ConservativeRippleEvaluation {
  const startMs = Math.max(0, Math.floor(params.startMs));
  const endMs = Math.max(startMs + 80, Math.floor(params.endMs));
  const issues: TranscriptPatchIssue[] = [];

  const lowConfidence = params.affectedSegments.some((segment) => {
    const confidence = segment.confidenceAvg;
    if (typeof confidence !== "number") {
      return true;
    }
    return confidence < params.minConfidence;
  });

  if (lowConfidence) {
    issues.push({
      code: "RIPPLE_LOW_CONFIDENCE",
      message: "One or more affected transcript segments are below confidence threshold.",
      severity: "WARN"
    });
    return {
      safe: false,
      suggestionsOnly: true,
      issues,
      timelineOperations: []
    };
  }

  const track = primaryVideoTrack(params.state);
  if (!track || track.clips.length === 0) {
    issues.push({
      code: "RIPPLE_NO_PRIMARY_VIDEO",
      message: "No primary video track available for conservative ripple.",
      severity: "WARN"
    });
    return {
      safe: false,
      suggestionsOnly: true,
      issues,
      timelineOperations: []
    };
  }

  const overlapping = track.clips.filter((clip) => clip.timelineInMs < endMs && clip.timelineOutMs > startMs);
  if (overlapping.length === 0) {
    issues.push({
      code: "RIPPLE_NO_OVERLAP",
      message: "Delete range does not overlap primary speech clip windows.",
      severity: "INFO"
    });
    return {
      safe: true,
      suggestionsOnly: false,
      issues,
      timelineOperations: []
    };
  }

  const operations: TimelineOperation[] = [];
  for (const clip of overlapping) {
    const overlapStart = Math.max(startMs, clip.timelineInMs);
    const overlapEnd = Math.min(endMs, clip.timelineOutMs);
    const overlapDuration = Math.max(0, overlapEnd - overlapStart);
    if (overlapDuration < 90) {
      continue;
    }

    const trimStartMs = overlapStart <= clip.timelineInMs ? overlapDuration : 0;
    const trimEndMs = overlapEnd >= clip.timelineOutMs ? overlapDuration : 0;

    if (trimStartMs > 0 || trimEndMs > 0) {
      operations.push({
        op: "trim_clip",
        trackId: track.id,
        clipId: clip.id,
        trimStartMs: trimStartMs > 0 ? trimStartMs : undefined,
        trimEndMs: trimEndMs > 0 ? trimEndMs : undefined
      });
      continue;
    }

    // If delete range is in the middle of a clip, split first then trim beginning of the right-side chunk.
    operations.push({
      op: "split_clip",
      trackId: track.id,
      clipId: clip.id,
      splitMs: overlapStart
    });
  }

  return {
    safe: true,
    suggestionsOnly: false,
    issues,
    timelineOperations: operations
  };
}
