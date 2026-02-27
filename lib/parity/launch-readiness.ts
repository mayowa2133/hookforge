import { Prisma } from "@prisma/client";
import { extractDurationMs, summarizeDesktopReliability } from "@/lib/desktop/events";
import { env } from "@/lib/env";
import { computePercentile, getQueueHealth, getSloSummary } from "@/lib/ops";
import { buildParityScorecardForWorkspace } from "@/lib/parity/scorecard";
import { prisma } from "@/lib/prisma";

export type DescriptPlusLaunchStage = "internal" | "pilot" | "small_team" | "global";

export type LaunchReadinessThresholds = {
  minParityScore: number;
  minRenderSuccessPct: number;
  minAiSuccessPct: number;
  maxQueueBacklog: number;
  maxQueueFailed: number;
  maxEditorOpenP95Ms: number;
  maxCommandP95Ms: number;
  minDesktopCrashFreePct: number;
};

export type LaunchGuardrailTrigger = {
  code:
    | "PARITY_SCORE_BELOW_MIN"
    | "RENDER_SUCCESS_BELOW_MIN"
    | "AI_SUCCESS_BELOW_MIN"
    | "QUEUE_UNHEALTHY"
    | "QUEUE_BACKLOG_HIGH"
    | "QUEUE_FAILED_HIGH"
    | "EDITOR_OPEN_LATENCY_HIGH"
    | "COMMAND_LATENCY_HIGH"
    | "DESKTOP_CRASH_FREE_BELOW_MIN";
  message: string;
  severity: "WARN" | "CRITICAL";
};

export type LaunchGuardrailStatus = "READY" | "CANARY_ONLY" | "ROLLBACK_RECOMMENDED";

type LaunchSnapshot = {
  parityScore: number;
  renderSuccessPct: number;
  aiSuccessPct: number;
  queueHealthy: boolean;
  queueBacklog: number;
  queueFailed: number;
  editorOpenP95Ms: number | null;
  commandP95Ms: number | null;
  desktopCrashFreePct: number | null;
};

export function resolveLaunchThresholds(): LaunchReadinessThresholds {
  return {
    minParityScore: env.DESCRIPT_PLUS_MIN_PARITY_SCORE,
    minRenderSuccessPct: env.DESCRIPT_PLUS_MIN_RENDER_SUCCESS_PCT,
    minAiSuccessPct: env.DESCRIPT_PLUS_MIN_AI_SUCCESS_PCT,
    maxQueueBacklog: env.DESCRIPT_PLUS_MAX_QUEUE_BACKLOG,
    maxQueueFailed: env.DESCRIPT_PLUS_MAX_QUEUE_FAILED,
    maxEditorOpenP95Ms: env.DESCRIPT_PLUS_MAX_EDITOR_OPEN_P95_MS,
    maxCommandP95Ms: env.DESCRIPT_PLUS_MAX_COMMAND_P95_MS,
    minDesktopCrashFreePct: env.DESCRIPT_PLUS_MIN_DESKTOP_CRASH_FREE_PCT
  };
}

export function parseRolloutAllowlist(raw: string) {
  return [...new Set(raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean))];
}

function emailDomain(email: string) {
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1 || atIndex === email.length - 1) {
    return "";
  }
  return email.slice(atIndex + 1).toLowerCase();
}

export function isEmailEligibleForLaunchStage(params: {
  stage: DescriptPlusLaunchStage;
  email: string;
  internalDomain: string;
  allowlist: string[];
}) {
  const normalizedEmail = params.email.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }
  if (params.stage === "global") {
    return true;
  }
  if (params.stage === "internal") {
    return emailDomain(normalizedEmail) === params.internalDomain.trim().toLowerCase();
  }
  return params.allowlist.includes(normalizedEmail);
}

export function evaluateLaunchGuardrails(params: {
  snapshot: LaunchSnapshot;
  thresholds: LaunchReadinessThresholds;
}) {
  const triggers: LaunchGuardrailTrigger[] = [];
  const { snapshot, thresholds } = params;

  if (snapshot.parityScore < thresholds.minParityScore) {
    triggers.push({
      code: "PARITY_SCORE_BELOW_MIN",
      message: `Parity score ${snapshot.parityScore.toFixed(2)} is below minimum ${thresholds.minParityScore}.`,
      severity: "CRITICAL"
    });
  }
  if (snapshot.renderSuccessPct < thresholds.minRenderSuccessPct) {
    triggers.push({
      code: "RENDER_SUCCESS_BELOW_MIN",
      message: `Render success ${snapshot.renderSuccessPct.toFixed(2)}% is below minimum ${thresholds.minRenderSuccessPct}%.`,
      severity: "CRITICAL"
    });
  }
  if (snapshot.aiSuccessPct < thresholds.minAiSuccessPct) {
    triggers.push({
      code: "AI_SUCCESS_BELOW_MIN",
      message: `AI success ${snapshot.aiSuccessPct.toFixed(2)}% is below minimum ${thresholds.minAiSuccessPct}%.`,
      severity: "CRITICAL"
    });
  }
  if (!snapshot.queueHealthy) {
    triggers.push({
      code: "QUEUE_UNHEALTHY",
      message: "Queue health endpoint reports at least one unhealthy queue.",
      severity: "CRITICAL"
    });
  }
  if (snapshot.queueBacklog > thresholds.maxQueueBacklog) {
    triggers.push({
      code: "QUEUE_BACKLOG_HIGH",
      message: `Queue backlog ${snapshot.queueBacklog} exceeds max ${thresholds.maxQueueBacklog}.`,
      severity: "WARN"
    });
  }
  if (snapshot.queueFailed > thresholds.maxQueueFailed) {
    triggers.push({
      code: "QUEUE_FAILED_HIGH",
      message: `Queue failed count ${snapshot.queueFailed} exceeds max ${thresholds.maxQueueFailed}.`,
      severity: "CRITICAL"
    });
  }
  if (snapshot.editorOpenP95Ms !== null && snapshot.editorOpenP95Ms > thresholds.maxEditorOpenP95Ms) {
    triggers.push({
      code: "EDITOR_OPEN_LATENCY_HIGH",
      message: `Editor open p95 ${snapshot.editorOpenP95Ms}ms exceeds max ${thresholds.maxEditorOpenP95Ms}ms.`,
      severity: "WARN"
    });
  }
  if (snapshot.commandP95Ms !== null && snapshot.commandP95Ms > thresholds.maxCommandP95Ms) {
    triggers.push({
      code: "COMMAND_LATENCY_HIGH",
      message: `Command latency p95 ${snapshot.commandP95Ms}ms exceeds max ${thresholds.maxCommandP95Ms}ms.`,
      severity: "WARN"
    });
  }
  if (snapshot.desktopCrashFreePct !== null && snapshot.desktopCrashFreePct < thresholds.minDesktopCrashFreePct) {
    triggers.push({
      code: "DESKTOP_CRASH_FREE_BELOW_MIN",
      message: `Desktop crash-free sessions ${snapshot.desktopCrashFreePct.toFixed(2)}% is below minimum ${thresholds.minDesktopCrashFreePct}%.`,
      severity: "CRITICAL"
    });
  }

  return triggers;
}

function inferGuardrailStatus(params: {
  stage: DescriptPlusLaunchStage;
  eligibleForStage: boolean;
  autoRollbackEnabled: boolean;
  triggers: LaunchGuardrailTrigger[];
}) {
  if (params.autoRollbackEnabled && params.triggers.some((trigger) => trigger.severity === "CRITICAL")) {
    return "ROLLBACK_RECOMMENDED" as const;
  }
  if (params.stage !== "global" || !params.eligibleForStage) {
    return "CANARY_ONLY" as const;
  }
  return "READY" as const;
}

async function syncLaunchIncident(params: {
  workspaceId: string;
  status: LaunchGuardrailStatus;
  triggers: LaunchGuardrailTrigger[];
  snapshot: LaunchSnapshot;
  thresholds: LaunchReadinessThresholds;
}) {
  const category = "DESCRIPT_PLUS_LAUNCH";
  const active = await prisma.systemIncident.findFirst({
    where: {
      workspaceId: params.workspaceId,
      category,
      status: "OPEN"
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  if (params.status === "ROLLBACK_RECOMMENDED") {
    const metadata = {
      triggers: params.triggers,
      snapshot: params.snapshot,
      thresholds: params.thresholds
    } as Prisma.InputJsonValue;
    if (active) {
      await prisma.systemIncident.update({
        where: { id: active.id },
        data: {
          severity: "HIGH",
          summary: "Phase 6 launch guardrail breach detected",
          metadata
        }
      });
      return;
    }
    await prisma.systemIncident.create({
      data: {
        workspaceId: params.workspaceId,
        category,
        severity: "HIGH",
        status: "OPEN",
        summary: "Phase 6 launch guardrail breach detected",
        metadata
      }
    });
    return;
  }

  if (active) {
    await prisma.systemIncident.update({
      where: { id: active.id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        summary: "Phase 6 launch guardrails recovered",
        metadata: {
          recovered: true,
          snapshot: params.snapshot
        } as Prisma.InputJsonValue
      }
    });
  }
}

export async function buildDescriptPlusLaunchReadiness(params: {
  workspaceId: string;
  userEmail?: string;
  windowHours?: number;
  persistIncident?: boolean;
}) {
  const stage = env.DESCRIPT_PLUS_ROLLOUT_STAGE;
  const allowlist = parseRolloutAllowlist(env.DESCRIPT_PLUS_ROLLOUT_ALLOWLIST);
  const thresholds = resolveLaunchThresholds();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [slo, queue, scorecard, feedbackRows, latestBenchmark] = await Promise.all([
    getSloSummary({
      workspaceId: params.workspaceId,
      windowHours: params.windowHours ?? 24
    }),
    getQueueHealth(),
    buildParityScorecardForWorkspace(params.workspaceId),
    prisma.qualityFeedback.findMany({
      where: {
        workspaceId: params.workspaceId,
        category: {
          in: [
            "desktop.editor_boot",
            "desktop.command_latency",
            "desktop.app_crash",
            "desktop.native_crash"
          ]
        },
        createdAt: {
          gte: since
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 800,
      select: {
        category: true,
        metadata: true
      }
    }),
    prisma.parityBenchmarkRun.findFirst({
      where: {
        workspaceId: params.workspaceId,
        status: "DONE"
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        createdAt: true,
        finishedAt: true,
        summary: true
      }
    })
  ]);

  const editorOpenDurations: number[] = [];
  const commandDurations: number[] = [];
  for (const row of feedbackRows) {
    const duration = extractDurationMs(row.metadata);
    if (duration === null) {
      continue;
    }
    if (row.category === "desktop.editor_boot") {
      editorOpenDurations.push(duration);
    } else if (row.category === "desktop.command_latency") {
      commandDurations.push(duration);
    }
  }
  const reliability = summarizeDesktopReliability(
    feedbackRows.map((row) => ({
      event: row.category.startsWith("desktop.") ? row.category.slice("desktop.".length) : row.category,
      outcome: typeof row.metadata === "object" && row.metadata && "outcome" in row.metadata
        ? (row.metadata as { outcome?: unknown }).outcome as string | null
        : null,
      metadata: row.metadata
    }))
  );

  const queueBacklog = queue.queues.reduce((sum, entry) => sum + entry.backlog, 0);
  const queueFailed = queue.queues.reduce((sum, entry) => sum + (entry.counts.failed ?? 0), 0);
  const snapshot: LaunchSnapshot = {
    parityScore: scorecard.overallScore,
    renderSuccessPct: slo.render.successRatePct,
    aiSuccessPct: slo.ai.successRatePct,
    queueHealthy: queue.healthy,
    queueBacklog,
    queueFailed,
    editorOpenP95Ms: editorOpenDurations.length > 0 ? computePercentile(editorOpenDurations, 95) : null,
    commandP95Ms: commandDurations.length > 0 ? computePercentile(commandDurations, 95) : null,
    desktopCrashFreePct: reliability.crashFreeSessionsPct
  };

  const triggers = evaluateLaunchGuardrails({
    snapshot,
    thresholds
  });
  const eligibleForStage = params.userEmail
    ? isEmailEligibleForLaunchStage({
        stage,
        email: params.userEmail,
        internalDomain: env.DESCRIPT_PLUS_INTERNAL_DOMAIN,
        allowlist
      })
    : stage === "global";

  const status = inferGuardrailStatus({
    stage,
    eligibleForStage,
    autoRollbackEnabled: env.DESCRIPT_PLUS_AUTO_ROLLBACK,
    triggers
  });

  if (params.persistIncident) {
    await syncLaunchIncident({
      workspaceId: params.workspaceId,
      status,
      triggers,
      snapshot,
      thresholds
    });
  }

  const benchmarkSummary =
    latestBenchmark?.summary && typeof latestBenchmark.summary === "object"
      ? (latestBenchmark.summary as Record<string, unknown>)
      : null;

  return {
    workspaceId: params.workspaceId,
    stage,
    generatedAt: new Date().toISOString(),
    rollout: {
      eligibleForStage,
      autoRollbackEnabled: env.DESCRIPT_PLUS_AUTO_ROLLBACK,
      forceRollbackToLegacy: env.DESCRIPT_PLUS_FORCE_ROLLBACK_TO_LEGACY,
      allowlistSize: allowlist.length
    },
    thresholds,
    snapshot,
    guardrails: {
      status,
      shouldRollback: status === "ROLLBACK_RECOMMENDED",
      triggers
    },
    scorecard: {
      overallScore: scorecard.overallScore,
      passRate: scorecard.passRate,
      passedModules: scorecard.passedModules,
      totalModules: scorecard.totalModules
    },
    latestBenchmark: latestBenchmark
      ? {
          id: latestBenchmark.id,
          createdAt: latestBenchmark.createdAt.toISOString(),
          finishedAt: latestBenchmark.finishedAt?.toISOString() ?? null,
          summary: benchmarkSummary,
          betterThanDescript:
            benchmarkSummary && typeof benchmarkSummary.betterThanDescript === "boolean"
              ? (benchmarkSummary.betterThanDescript as boolean)
              : null
        }
      : null,
    queue,
    slo
  };
}
