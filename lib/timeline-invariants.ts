import { applyTimelineOperations } from "@/lib/timeline-legacy";
import type { TimelineOperation, TimelineState } from "@/lib/timeline-types";

export type TimelineInvariantIssue = {
  code: string;
  message: string;
  trackId?: string;
  clipId?: string;
};

export type TimelinePreviewResult = {
  valid: boolean;
  issues: TimelineInvariantIssue[];
  nextState: TimelineState | null;
  timelineHash: string | null;
  revision: number | null;
};

function issue(code: string, message: string, trackId?: string, clipId?: string): TimelineInvariantIssue {
  return { code, message, trackId, clipId };
}

function isFiniteInteger(value: number) {
  return Number.isFinite(value) && Number.isInteger(value);
}

export function validateTimelineStateInvariants(state: TimelineState): TimelineInvariantIssue[] {
  const issues: TimelineInvariantIssue[] = [];

  if (!isFiniteInteger(state.version) || state.version < 1) {
    issues.push(issue("STATE_VERSION_INVALID", "Timeline version must be an integer >= 1"));
  }

  if (!Number.isFinite(state.fps) || state.fps <= 0) {
    issues.push(issue("STATE_FPS_INVALID", "Timeline FPS must be > 0"));
  }

  if (!isFiniteInteger(state.resolution.width) || state.resolution.width < 120) {
    issues.push(issue("STATE_WIDTH_INVALID", "Timeline width must be an integer >= 120"));
  }

  if (!isFiniteInteger(state.resolution.height) || state.resolution.height < 120) {
    issues.push(issue("STATE_HEIGHT_INVALID", "Timeline height must be an integer >= 120"));
  }

  const seenTrackIds = new Set<string>();
  const seenClipIds = new Set<string>();

  for (const track of state.tracks) {
    if (!track.id || track.id.trim().length === 0) {
      issues.push(issue("TRACK_ID_MISSING", "Track id is required"));
      continue;
    }

    if (seenTrackIds.has(track.id)) {
      issues.push(issue("TRACK_ID_DUPLICATE", `Duplicate track id: ${track.id}`, track.id));
      continue;
    }
    seenTrackIds.add(track.id);

    if (!isFiniteInteger(track.order) || track.order < 0) {
      issues.push(issue("TRACK_ORDER_INVALID", "Track order must be an integer >= 0", track.id));
    }

    if (!Number.isFinite(track.volume) || track.volume < 0 || track.volume > 1.5) {
      issues.push(issue("TRACK_VOLUME_INVALID", "Track volume must be between 0 and 1.5", track.id));
    }

    const seenEffectIds = new Set<string>();

    for (const clip of track.clips) {
      if (!clip.id || clip.id.trim().length === 0) {
        issues.push(issue("CLIP_ID_MISSING", "Clip id is required", track.id));
        continue;
      }

      if (seenClipIds.has(clip.id)) {
        issues.push(issue("CLIP_ID_DUPLICATE", `Duplicate clip id: ${clip.id}`, track.id, clip.id));
      }
      seenClipIds.add(clip.id);

      if (!isFiniteInteger(clip.timelineInMs) || clip.timelineInMs < 0) {
        issues.push(issue("CLIP_TIMELINE_IN_INVALID", "Clip timelineInMs must be an integer >= 0", track.id, clip.id));
      }

      if (!isFiniteInteger(clip.timelineOutMs) || clip.timelineOutMs <= clip.timelineInMs) {
        issues.push(issue("CLIP_TIMELINE_OUT_INVALID", "Clip timelineOutMs must be > timelineInMs", track.id, clip.id));
      }

      if (!isFiniteInteger(clip.sourceInMs) || clip.sourceInMs < 0) {
        issues.push(issue("CLIP_SOURCE_IN_INVALID", "Clip sourceInMs must be an integer >= 0", track.id, clip.id));
      }

      if (!isFiniteInteger(clip.sourceOutMs) || clip.sourceOutMs < clip.sourceInMs) {
        issues.push(issue("CLIP_SOURCE_OUT_INVALID", "Clip sourceOutMs must be >= sourceInMs", track.id, clip.id));
      }

      for (const effect of clip.effects) {
        if (!effect.id || effect.id.trim().length === 0) {
          issues.push(issue("EFFECT_ID_MISSING", "Effect id is required", track.id, clip.id));
          continue;
        }

        if (seenEffectIds.has(effect.id)) {
          issues.push(issue("EFFECT_ID_DUPLICATE", `Duplicate effect id: ${effect.id}`, track.id, clip.id));
        }
        seenEffectIds.add(effect.id);

        for (const keyframe of effect.keyframes) {
          if (!isFiniteInteger(keyframe.timeMs) || keyframe.timeMs < 0) {
            issues.push(issue("KEYFRAME_TIME_INVALID", "Keyframe timeMs must be an integer >= 0", track.id, clip.id));
          }
        }
      }
    }
  }

  return issues;
}

export function previewTimelineOperationsWithValidation(params: {
  state: TimelineState;
  operations: TimelineOperation[];
}): TimelinePreviewResult {
  const cloned = structuredClone(params.state) as TimelineState;

  try {
    const applied = applyTimelineOperations(cloned, params.operations);
    const issues = validateTimelineStateInvariants(applied.state);
    if (issues.length > 0) {
      return {
        valid: false,
        issues,
        nextState: null,
        timelineHash: null,
        revision: null
      };
    }

    return {
      valid: true,
      issues: [],
      nextState: applied.state,
      timelineHash: applied.timelineHash,
      revision: applied.revision
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Timeline apply failed";
    return {
      valid: false,
      issues: [issue("APPLY_FAILED", message)],
      nextState: null,
      timelineHash: null,
      revision: null
    };
  }
}
