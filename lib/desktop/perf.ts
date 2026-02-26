type PerfHintSeverity = "INFO" | "WARN";

export type ProjectPerfHint = {
  id: string;
  severity: PerfHintSeverity;
  message: string;
  action: string;
};

export type ProjectPerfHints = {
  budgets: {
    editorOpenP95Ms: number;
    commandLatencyP95Ms: number;
  };
  observed: {
    editorOpenP95Ms: number | null;
    commandLatencyP95Ms: number | null;
  };
  suggested: {
    timelineWindowSize: number;
    segmentWindowSize: number;
    enableLaneCollapse: boolean;
    preferredZoomPercent: number;
  };
  hints: ProjectPerfHint[];
};

function percentile95(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[index];
}

export function buildProjectPerfHints(input: {
  trackCount: number;
  clipCount: number;
  segmentCount: number;
  wordCount: number;
  hasRenderableMedia: boolean;
  editorOpenDurationsMs: number[];
  commandDurationsMs: number[];
}): ProjectPerfHints {
  const budgets = {
    editorOpenP95Ms: 2500,
    commandLatencyP95Ms: 100
  };
  const observed = {
    editorOpenP95Ms: percentile95(input.editorOpenDurationsMs),
    commandLatencyP95Ms: percentile95(input.commandDurationsMs)
  };

  const suggested = {
    timelineWindowSize: input.clipCount > 260 ? 36 : input.clipCount > 150 ? 48 : 60,
    segmentWindowSize: input.wordCount > 8000 ? 120 : input.wordCount > 5000 ? 160 : 220,
    enableLaneCollapse: input.trackCount >= 4 || input.clipCount >= 120,
    preferredZoomPercent: input.clipCount > 220 ? 85 : 100
  };

  const hints: ProjectPerfHint[] = [];
  if (!input.hasRenderableMedia) {
    hints.push({
      id: "media_missing",
      severity: "WARN",
      message: "Project has no renderable media yet.",
      action: "Upload at least one video or image in the media rail."
    });
  }
  if (input.wordCount > 5000) {
    hints.push({
      id: "transcript_virtualize",
      severity: "INFO",
      message: "Large transcript detected. Keep transcript window virtualized.",
      action: `Keep visible segment window <= ${suggested.segmentWindowSize}.`
    });
  }
  if (input.clipCount > 150) {
    hints.push({
      id: "timeline_virtualize",
      severity: "INFO",
      message: "High clip density detected. Use lane collapse and narrower visible track windows.",
      action: `Limit visible tracks and use timeline window <= ${suggested.timelineWindowSize}.`
    });
  }
  if (observed.editorOpenP95Ms !== null && observed.editorOpenP95Ms > budgets.editorOpenP95Ms) {
    hints.push({
      id: "open_latency_budget",
      severity: "WARN",
      message: `Editor open p95 (${observed.editorOpenP95Ms}ms) exceeds budget (${budgets.editorOpenP95Ms}ms).`,
      action: "Reduce initial API fan-out and defer non-critical panels after first paint."
    });
  }
  if (observed.commandLatencyP95Ms !== null && observed.commandLatencyP95Ms > budgets.commandLatencyP95Ms) {
    hints.push({
      id: "command_latency_budget",
      severity: "WARN",
      message: `Command latency p95 (${observed.commandLatencyP95Ms}ms) exceeds budget (${budgets.commandLatencyP95Ms}ms).`,
      action: "Enable optimistic updates for low-risk operations and batch state refreshes."
    });
  }

  return {
    budgets,
    observed,
    suggested,
    hints
  };
}
