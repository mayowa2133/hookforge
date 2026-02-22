export type TimelineClipWindow = {
  timelineInMs: number;
  timelineOutMs: number;
};

export function clampPlaybackSeekSeconds(params: {
  currentSeconds: number;
  deltaSeconds: number;
  durationSeconds?: number;
}) {
  const current = Number.isFinite(params.currentSeconds) ? params.currentSeconds : 0;
  const next = current + params.deltaSeconds;
  const lowerBound = 0;
  if (!Number.isFinite(params.durationSeconds) || params.durationSeconds === undefined || params.durationSeconds <= 0) {
    return Math.max(lowerBound, next);
  }
  return Math.max(lowerBound, Math.min(next, params.durationSeconds));
}

export function computeSplitPointMs(clip: TimelineClipWindow, playheadMs?: number) {
  const floor = clip.timelineInMs + 40;
  const ceiling = clip.timelineOutMs - 40;
  if (ceiling <= floor) {
    return Math.max(clip.timelineInMs + 1, Math.floor((clip.timelineInMs + clip.timelineOutMs) / 2));
  }

  if (playheadMs === undefined || !Number.isFinite(playheadMs)) {
    return Math.floor((clip.timelineInMs + clip.timelineOutMs) / 2);
  }
  return Math.max(floor, Math.min(Math.floor(playheadMs), ceiling));
}

export function computeTrackReorderTarget(order: number, direction: -1 | 1, trackCount: number) {
  if (!Number.isFinite(order) || trackCount <= 0) {
    return 0;
  }
  const raw = order + direction;
  return Math.max(0, Math.min(raw, trackCount - 1));
}
