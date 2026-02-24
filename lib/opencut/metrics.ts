export const OpenCutEventNames = [
  "editor_open",
  "transcript_edit_apply",
  "chat_edit_apply",
  "render_start",
  "render_done",
  "render_error"
] as const;

export type OpenCutEventName = (typeof OpenCutEventNames)[number];
export type OpenCutEventOutcome = "SUCCESS" | "ERROR" | "INFO";

type OpenCutEventRecord = {
  event: OpenCutEventName;
  outcome: OpenCutEventOutcome;
  createdAt: Date;
};

export type OpenCutEventMetric = {
  event: OpenCutEventName;
  total: number;
  success: number;
  error: number;
  info: number;
  successRate: number | null;
};

export type OpenCutMetricsSnapshot = {
  windowHours: number;
  totalEvents: number;
  metrics: OpenCutEventMetric[];
  generatedAt: string;
};

const OPEN_CUT_EVENT_NAME_SET = new Set<string>(OpenCutEventNames);

function emptyMetric(event: OpenCutEventName): OpenCutEventMetric {
  return {
    event,
    total: 0,
    success: 0,
    error: 0,
    info: 0,
    successRate: null
  };
}

export function normalizeOpenCutEventName(value: string): OpenCutEventName | null {
  if (OPEN_CUT_EVENT_NAME_SET.has(value)) {
    return value as OpenCutEventName;
  }
  return null;
}

export function summarizeOpenCutMetrics(params: { windowHours: number; events: OpenCutEventRecord[] }): OpenCutMetricsSnapshot {
  const metricsByEvent = new Map<OpenCutEventName, OpenCutEventMetric>();
  for (const eventName of OpenCutEventNames) {
    metricsByEvent.set(eventName, emptyMetric(eventName));
  }

  for (const item of params.events) {
    const metric = metricsByEvent.get(item.event);
    if (!metric) {
      continue;
    }
    metric.total += 1;
    if (item.outcome === "SUCCESS") {
      metric.success += 1;
    } else if (item.outcome === "ERROR") {
      metric.error += 1;
    } else {
      metric.info += 1;
    }
  }

  for (const metric of metricsByEvent.values()) {
    const denominator = metric.success + metric.error;
    metric.successRate = denominator > 0 ? metric.success / denominator : null;
  }

  return {
    windowHours: params.windowHours,
    totalEvents: params.events.length,
    metrics: OpenCutEventNames.map((eventName) => metricsByEvent.get(eventName) as OpenCutEventMetric),
    generatedAt: new Date().toISOString()
  };
}
