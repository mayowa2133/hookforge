import { z } from "zod";

export const mobileWorkflowIds = ["creator_to_render", "template_edit_render", "localization_dub"] as const;
export type MobileWorkflowId = (typeof mobileWorkflowIds)[number];

export const mobileWorkflowCatalog: Array<{
  id: MobileWorkflowId;
  title: string;
  webBaselineCompletionRatePct: number;
}> = [
  {
    id: "creator_to_render",
    title: "Creator to Render",
    webBaselineCompletionRatePct: 86
  },
  {
    id: "template_edit_render",
    title: "Template Edit to Render",
    webBaselineCompletionRatePct: 89
  },
  {
    id: "localization_dub",
    title: "Localization Dub",
    webBaselineCompletionRatePct: 84
  }
];

export const MobileTelemetryEventSchema = z.object({
  sessionId: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]).default("ios"),
  event: z.enum([
    "SESSION_START",
    "SESSION_END",
    "SESSION_CRASH",
    "WORKFLOW_START",
    "WORKFLOW_COMPLETE",
    "UPLOAD_RESUME",
    "UPLOAD_FAIL",
    "EXPORT_START",
    "EXPORT_COMPLETE"
  ]),
  workflowId: z.enum(mobileWorkflowIds).optional(),
  latencyMs: z.number().int().min(0).max(300000).optional(),
  timestamp: z.string().datetime().optional()
});

export const MobileTelemetryIngestSchema = z.object({
  events: z.array(MobileTelemetryEventSchema).min(1).max(100)
});

export type MobileTelemetryEvent = z.infer<typeof MobileTelemetryEventSchema>;

export type MobileGlobalCounters = {
  sessionsStarted: number;
  sessionsEnded: number;
  sessionsCrashed: number;
  workflowStartedTotal: number;
  workflowCompletedTotal: number;
  uploadResumes: number;
  uploadFailures: number;
  exportsStarted: number;
  exportsCompleted: number;
  latencySumMs: number;
  latencyCount: number;
};

export type MobileWorkflowCounters = {
  started: number;
  completed: number;
  latencySumMs: number;
  latencyCount: number;
};

export function emptyMobileGlobalCounters(): MobileGlobalCounters {
  return {
    sessionsStarted: 0,
    sessionsEnded: 0,
    sessionsCrashed: 0,
    workflowStartedTotal: 0,
    workflowCompletedTotal: 0,
    uploadResumes: 0,
    uploadFailures: 0,
    exportsStarted: 0,
    exportsCompleted: 0,
    latencySumMs: 0,
    latencyCount: 0
  };
}

export function emptyMobileWorkflowCounters(): MobileWorkflowCounters {
  return {
    started: 0,
    completed: 0,
    latencySumMs: 0,
    latencyCount: 0
  };
}

function addLatency(
  counters: { latencySumMs: number; latencyCount: number },
  latencyMs: number | undefined
): { latencySumMs: number; latencyCount: number } {
  if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs)) {
    return counters;
  }
  return {
    latencySumMs: counters.latencySumMs + latencyMs,
    latencyCount: counters.latencyCount + 1
  };
}

export function applyMobileTelemetryEvent(
  globalCounters: MobileGlobalCounters,
  workflowCounters: Record<MobileWorkflowId, MobileWorkflowCounters>,
  event: MobileTelemetryEvent
) {
  const nextGlobal = { ...globalCounters };
  const nextWorkflow = { ...workflowCounters };

  switch (event.event) {
    case "SESSION_START":
      nextGlobal.sessionsStarted += 1;
      break;
    case "SESSION_END":
      nextGlobal.sessionsEnded += 1;
      break;
    case "SESSION_CRASH":
      nextGlobal.sessionsCrashed += 1;
      break;
    case "WORKFLOW_START":
      nextGlobal.workflowStartedTotal += 1;
      if (event.workflowId) {
        const current = nextWorkflow[event.workflowId] ?? emptyMobileWorkflowCounters();
        nextWorkflow[event.workflowId] = {
          ...current,
          started: current.started + 1
        };
      }
      break;
    case "WORKFLOW_COMPLETE":
      nextGlobal.workflowCompletedTotal += 1;
      if (event.workflowId) {
        const current = nextWorkflow[event.workflowId] ?? emptyMobileWorkflowCounters();
        const withLatency = addLatency(current, event.latencyMs);
        nextWorkflow[event.workflowId] = {
          ...current,
          completed: current.completed + 1,
          latencySumMs: withLatency.latencySumMs,
          latencyCount: withLatency.latencyCount
        };
      }
      break;
    case "UPLOAD_RESUME":
      nextGlobal.uploadResumes += 1;
      break;
    case "UPLOAD_FAIL":
      nextGlobal.uploadFailures += 1;
      break;
    case "EXPORT_START":
      nextGlobal.exportsStarted += 1;
      break;
    case "EXPORT_COMPLETE":
      nextGlobal.exportsCompleted += 1;
      break;
    default:
      break;
  }

  const withGlobalLatency = addLatency(nextGlobal, event.latencyMs);
  nextGlobal.latencySumMs = withGlobalLatency.latencySumMs;
  nextGlobal.latencyCount = withGlobalLatency.latencyCount;

  return {
    global: nextGlobal,
    workflows: nextWorkflow
  };
}

const telemetryGlobalKey = "hookforge:mobile:telemetry:global";
const telemetryWorkflowKey = (workflowId: MobileWorkflowId) => `hookforge:mobile:telemetry:workflow:${workflowId}`;
const TELEMETRY_TTL_SEC = 60 * 60 * 24 * 30;

const globalFieldMap: Record<keyof MobileGlobalCounters, string> = {
  sessionsStarted: "sessions_started",
  sessionsEnded: "sessions_ended",
  sessionsCrashed: "sessions_crashed",
  workflowStartedTotal: "workflow_started_total",
  workflowCompletedTotal: "workflow_completed_total",
  uploadResumes: "upload_resumes",
  uploadFailures: "upload_failures",
  exportsStarted: "exports_started",
  exportsCompleted: "exports_completed",
  latencySumMs: "latency_sum_ms",
  latencyCount: "latency_count"
};

const workflowFieldMap: Record<keyof MobileWorkflowCounters, string> = {
  started: "started",
  completed: "completed",
  latencySumMs: "latency_sum_ms",
  latencyCount: "latency_count"
};

function parseHashNumber(source: Record<string, string>, field: string) {
  const parsed = Number(source[field] ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readGlobalCountersFromHash(hash: Record<string, string>): MobileGlobalCounters {
  return {
    sessionsStarted: parseHashNumber(hash, globalFieldMap.sessionsStarted),
    sessionsEnded: parseHashNumber(hash, globalFieldMap.sessionsEnded),
    sessionsCrashed: parseHashNumber(hash, globalFieldMap.sessionsCrashed),
    workflowStartedTotal: parseHashNumber(hash, globalFieldMap.workflowStartedTotal),
    workflowCompletedTotal: parseHashNumber(hash, globalFieldMap.workflowCompletedTotal),
    uploadResumes: parseHashNumber(hash, globalFieldMap.uploadResumes),
    uploadFailures: parseHashNumber(hash, globalFieldMap.uploadFailures),
    exportsStarted: parseHashNumber(hash, globalFieldMap.exportsStarted),
    exportsCompleted: parseHashNumber(hash, globalFieldMap.exportsCompleted),
    latencySumMs: parseHashNumber(hash, globalFieldMap.latencySumMs),
    latencyCount: parseHashNumber(hash, globalFieldMap.latencyCount)
  };
}

function readWorkflowCountersFromHash(hash: Record<string, string>): MobileWorkflowCounters {
  return {
    started: parseHashNumber(hash, workflowFieldMap.started),
    completed: parseHashNumber(hash, workflowFieldMap.completed),
    latencySumMs: parseHashNumber(hash, workflowFieldMap.latencySumMs),
    latencyCount: parseHashNumber(hash, workflowFieldMap.latencyCount)
  };
}

export async function ingestMobileTelemetryEvents(events: MobileTelemetryEvent[]) {
  await runWithRedis(async (client) => {
    const multi = client.multi();

    for (const event of events) {
      if (event.event === "SESSION_START") {
        multi.hincrby(telemetryGlobalKey, globalFieldMap.sessionsStarted, 1);
      }
      if (event.event === "SESSION_END") {
        multi.hincrby(telemetryGlobalKey, globalFieldMap.sessionsEnded, 1);
      }
      if (event.event === "SESSION_CRASH") {
        multi.hincrby(telemetryGlobalKey, globalFieldMap.sessionsCrashed, 1);
      }
      if (event.event === "WORKFLOW_START") {
        multi.hincrby(telemetryGlobalKey, globalFieldMap.workflowStartedTotal, 1);
      }
      if (event.event === "WORKFLOW_COMPLETE") {
        multi.hincrby(telemetryGlobalKey, globalFieldMap.workflowCompletedTotal, 1);
      }
      if (event.event === "UPLOAD_RESUME") {
        multi.hincrby(telemetryGlobalKey, globalFieldMap.uploadResumes, 1);
      }
      if (event.event === "UPLOAD_FAIL") {
        multi.hincrby(telemetryGlobalKey, globalFieldMap.uploadFailures, 1);
      }
      if (event.event === "EXPORT_START") {
        multi.hincrby(telemetryGlobalKey, globalFieldMap.exportsStarted, 1);
      }
      if (event.event === "EXPORT_COMPLETE") {
        multi.hincrby(telemetryGlobalKey, globalFieldMap.exportsCompleted, 1);
      }

      if (typeof event.latencyMs === "number") {
        multi.hincrbyfloat(telemetryGlobalKey, globalFieldMap.latencySumMs, event.latencyMs);
        multi.hincrby(telemetryGlobalKey, globalFieldMap.latencyCount, 1);
      }

      if (event.workflowId) {
        const workflowKey = telemetryWorkflowKey(event.workflowId);
        if (event.event === "WORKFLOW_START") {
          multi.hincrby(workflowKey, workflowFieldMap.started, 1);
        }
        if (event.event === "WORKFLOW_COMPLETE") {
          multi.hincrby(workflowKey, workflowFieldMap.completed, 1);
        }
        if (typeof event.latencyMs === "number") {
          multi.hincrbyfloat(workflowKey, workflowFieldMap.latencySumMs, event.latencyMs);
          multi.hincrby(workflowKey, workflowFieldMap.latencyCount, 1);
        }
        multi.expire(workflowKey, TELEMETRY_TTL_SEC);
      }
    }

    multi.expire(telemetryGlobalKey, TELEMETRY_TTL_SEC);
    await multi.exec();
  });
}

export async function readMobileTelemetrySnapshot() {
  return runWithRedis(async (client) => {
    const globalHash = await client.hgetall(telemetryGlobalKey);
    const global = readGlobalCountersFromHash(globalHash);

    const workflows = Object.fromEntries(
      await Promise.all(
        mobileWorkflowCatalog.map(async (workflow) => {
          const hash = await client.hgetall(telemetryWorkflowKey(workflow.id));
          return [workflow.id, readWorkflowCountersFromHash(hash)];
        })
      )
    ) as Record<MobileWorkflowId, MobileWorkflowCounters>;

    return {
      global,
      workflows
    };
  });
}

function percentage(numerator: number, denominator: number, fallback = 100) {
  if (denominator <= 0) {
    return fallback;
  }
  const rate = (numerator / denominator) * 100;
  if (!Number.isFinite(rate)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Number(rate.toFixed(2))));
}

export function summarizeMobileTelemetry(params: {
  global: MobileGlobalCounters;
  workflows: Record<MobileWorkflowId, MobileWorkflowCounters>;
}) {
  const crashFreeSessionsPct = percentage(
    Math.max(0, params.global.sessionsStarted - params.global.sessionsCrashed),
    params.global.sessionsStarted,
    100
  );

  const workflowSummaries = mobileWorkflowCatalog.map((workflow) => {
    const counters = params.workflows[workflow.id] ?? emptyMobileWorkflowCounters();
    const mobileCompletionRatePct = percentage(counters.completed, counters.started, 100);
    const gapPct = Math.max(0, Number((workflow.webBaselineCompletionRatePct - mobileCompletionRatePct).toFixed(2)));
    return {
      id: workflow.id,
      title: workflow.title,
      webBaselineCompletionRatePct: workflow.webBaselineCompletionRatePct,
      mobileCompletionRatePct,
      completionGapPct: gapPct,
      started: counters.started,
      completed: counters.completed,
      avgLatencyMs: counters.latencyCount > 0 ? Number((counters.latencySumMs / counters.latencyCount).toFixed(2)) : 0
    };
  });

  const topWorkflowGapPct = workflowSummaries.reduce((max, workflow) => Math.max(max, workflow.completionGapPct), 0);

  return {
    crashFreeSessionsPct,
    topWorkflowGapPct,
    workflowSummaries,
    meetsCrashFreeTarget: crashFreeSessionsPct >= 99.5,
    meetsWorkflowGapTarget: topWorkflowGapPct <= 10
  };
}
async function runWithRedis<T>(fn: (client: any) => Promise<T>) {
  const { withRedis } = await import("@/lib/redis");
  return withRedis(fn);
}
