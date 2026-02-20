import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { metrics as appMetrics } from "@/lib/observability/metrics";
import { buildDefaultMetricsForCapability, evaluateQualityGate } from "@/lib/quality/gates";
import type { QualityMetricSet } from "@/lib/quality/types";

function asFiniteNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

export function normalizeMetricSet(input: Record<string, unknown> | undefined) {
  const metrics: QualityMetricSet = {
    successRate: asFiniteNumber(input?.successRate),
    latencyP95Ms: asFiniteNumber(input?.latencyP95Ms),
    werEnglish: asFiniteNumber(input?.werEnglish),
    werTop10: asFiniteNumber(input?.werTop10),
    timingMedianMs: asFiniteNumber(input?.timingMedianMs),
    timingP95Ms: asFiniteNumber(input?.timingP95Ms),
    dubbingMos: asFiniteNumber(input?.dubbingMos),
    lipSyncMedianMs: asFiniteNumber(input?.lipSyncMedianMs),
    lipSyncP95Ms: asFiniteNumber(input?.lipSyncP95Ms),
    validPlanRate: asFiniteNumber(input?.validPlanRate),
    undoCorrectnessRate: asFiniteNumber(input?.undoCorrectnessRate),
    apiSuccessRate: asFiniteNumber(input?.apiSuccessRate),
    crashFreeSessions: asFiniteNumber(input?.crashFreeSessions),
    workflowCompletionGapPct: asFiniteNumber(input?.workflowCompletionGapPct),
    ratingScore: asFiniteNumber(input?.ratingScore),
    candidateUpliftPct: asFiniteNumber(input?.candidateUpliftPct),
    ledgerReconciliationRate: asFiniteNumber(input?.ledgerReconciliationRate),
    criticalBillingDefects: asFiniteNumber(input?.criticalBillingDefects),
    costPerMinUsd: asFiniteNumber(input?.costPerMinUsd)
  };

  const compacted: QualityMetricSet = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number") {
      compacted[key as keyof QualityMetricSet] = value;
    }
  }

  return compacted;
}

export async function createQualityEvalRun(params: {
  capability: string;
  modelVersionId?: string;
  datasetRef?: string;
  trigger?: string;
  createdByUserId?: string;
  metricInput?: Record<string, unknown>;
}) {
  const run = await prisma.qualityEvalRun.create({
    data: {
      capability: params.capability,
      modelVersionId: params.modelVersionId,
      datasetRef: params.datasetRef,
      trigger: params.trigger ?? "manual",
      status: "RUNNING",
      createdByUserId: params.createdByUserId,
      startedAt: new Date()
    }
  });

  const normalizedMetrics = normalizeMetricSet(params.metricInput);
  const metrics = Object.keys(normalizedMetrics).length > 0
    ? normalizedMetrics
    : buildDefaultMetricsForCapability(params.capability);

  const gate = evaluateQualityGate({
    capability: params.capability,
    metrics
  });

  const finishedRun = await prisma.qualityEvalRun.update({
    where: { id: run.id },
    data: {
      status: "DONE",
      metrics: {
        gate,
        metrics
      } as Prisma.InputJsonValue,
      passed: gate.passed,
      summary: gate.passed
        ? `Quality gate passed for ${gate.capability}`
        : `Quality gate failed for ${gate.capability}: ${gate.reasons.join("; ")}`,
      finishedAt: new Date()
    }
  });

  if (params.modelVersionId) {
    await prisma.modelVersion.update({
      where: { id: params.modelVersionId },
      data: {
        qualityScore: gate.passed ? 1 : 0,
        successRate: metrics.successRate,
        latencyP95Ms: metrics.latencyP95Ms
      }
    });
  }

  appMetrics.increment("quality_eval_run_completed", 1, {
    capability: gate.capability,
    passed: gate.passed
  });

  return {
    run: finishedRun,
    gate,
    metrics
  };
}

export async function summarizeQualityMetrics(limit = 100) {
  const evalRuns = await prisma.qualityEvalRun.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(10, Math.min(500, limit)),
    include: {
      modelVersion: {
        select: {
          id: true,
          capability: true,
          provider: true,
          model: true,
          version: true,
          status: true
        }
      }
    }
  });

  const latestByCapability = new Map<string, (typeof evalRuns)[number]>();
  for (const run of evalRuns) {
    if (!latestByCapability.has(run.capability)) {
      latestByCapability.set(run.capability, run);
    }
  }

  const [openAnomalies, feedbackStats, routingPolicies] = await Promise.all([
    prisma.usageAnomaly.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    prisma.qualityFeedback.groupBy({
      by: ["category"],
      _count: { _all: true },
      _avg: { rating: true }
    }),
    prisma.routingPolicy.findMany({
      include: {
        activeModelVersion: true,
        fallbackModelVersion: true
      },
      orderBy: { capability: "asc" }
    })
  ]);

  return {
    generatedAt: new Date().toISOString(),
    latestByCapability: Array.from(latestByCapability.values()).map((run) => ({
      id: run.id,
      capability: run.capability,
      status: run.status,
      passed: run.passed,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      modelVersion: run.modelVersion
    })),
    openAnomalies,
    feedbackStats,
    routingPolicies,
    inMemoryMetricsSnapshot: appMetrics.snapshot()
  };
}
