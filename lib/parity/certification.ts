import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "@/lib/env";
import { buildDescriptPlusLaunchReadiness } from "@/lib/parity/launch-readiness";
import { buildParityScorecardForWorkspace } from "@/lib/parity/scorecard";
import { prisma } from "@/lib/prisma";
import { summarizeQualityMetrics } from "@/lib/quality/evals";

const FeatureMatrixSchema = z.object({
  baselineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  competitor: z.string().min(1),
  features: z.array(
    z.object({
      id: z.string().min(1),
      status: z.enum(["planned", "in_progress", "implemented", "verified"]),
      coverage: z.object({
        api: z.array(z.string().min(1)).default([]),
        ui: z.array(z.string().min(1)).default([]),
        tests: z.array(z.string().min(1)).default([])
      })
    })
  ).min(1)
});

export const DescriptDiffRecordSchema = z.object({
  comparisonMonth: z.string().regex(/^\d{4}-\d{2}$/),
  source: z.string().min(2).max(80).default("manual"),
  notes: z.string().max(2000).optional(),
  discoveredFeatures: z.array(
    z.object({
      title: z.string().min(2).max(240),
      changeType: z.enum(["added", "changed", "removed"]),
      mappedFeatureId: z.string().min(1).max(120).optional(),
      status: z.enum(["mapped", "gap", "deferred"]).default("mapped")
    })
  ).default([]),
  unresolvedDriftCount: z.coerce.number().int().min(0).default(0)
});

export const ReleaseCandidateFreezeSchema = z.object({
  releaseTag: z.string().min(2).max(80),
  notes: z.string().max(2000).optional()
});

export const ReleaseCandidateUnfreezeSchema = z.object({
  notes: z.string().max(2000).optional()
});

export const Phase6PilotFeedbackSchema = z.object({
  cohort: z.enum(["dogfood", "pilot"]),
  sessionId: z.string().min(2).max(120),
  workflowSuccessPct: z.number().min(0).max(100),
  blockerCount: z.coerce.number().int().min(0).max(100).default(0),
  crashCount: z.coerce.number().int().min(0).max(100).default(0),
  participantCount: z.coerce.number().int().min(1).max(500).default(1),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  notes: z.string().max(2000).optional()
});

export type CertificationDimensionId =
  | "feature_matrix"
  | "workflow_parity"
  | "ux_slo_parity"
  | "quality_parity"
  | "ecosystem_parity"
  | "operational_parity";

export type CertificationDimensionResult = {
  id: CertificationDimensionId;
  label: string;
  passed: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

type CertificationHistoryEntry = {
  createdAt: Date;
  passed: boolean;
};

type PilotFeedbackSummary = {
  cohort: "dogfood" | "pilot";
  totalSessions: number;
  averageWorkflowSuccessPct: number | null;
  averageRating: number | null;
  totalBlockers: number;
  totalCrashes: number;
  totalParticipants: number;
};

type ReleaseCandidateState = {
  frozen: boolean;
  frozenAt: string | null;
  frozenDays: number;
  releaseTag: string | null;
  notes: string | null;
};

type DescriptDiffState = {
  hasRecord: boolean;
  comparisonMonth: string | null;
  comparedAt: string | null;
  source: string | null;
  unresolvedDriftCount: number;
  discoveredFeatureCount: number;
  freshnessDays: number | null;
  currentMonth: string;
  meetsFreshnessWindow: boolean;
  meetsCurrentMonth: boolean;
  passed: boolean;
};

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  return null;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function daysBetween(older: Date, newer: Date) {
  return Math.max(0, Math.floor((newer.getTime() - older.getTime()) / (24 * 60 * 60 * 1000)));
}

function summarizePilotFeedback(rows: Array<{ category: string; rating: number | null; metadata: Prisma.JsonValue }>) {
  const summarize = (cohort: "dogfood" | "pilot"): PilotFeedbackSummary => {
    const cohortRows = rows.filter((row) =>
      row.category === (cohort === "dogfood" ? "phase6.dogfood.session" : "phase6.pilot.session")
    );

    const workflowSuccessValues: number[] = [];
    const ratings: number[] = [];
    let totalBlockers = 0;
    let totalCrashes = 0;
    let totalParticipants = 0;

    for (const row of cohortRows) {
      const metadata = asRecord(row.metadata);
      const workflowSuccessPct = parseNumber(metadata?.workflowSuccessPct);
      const blockerCount = parseNumber(metadata?.blockerCount) ?? 0;
      const crashCount = parseNumber(metadata?.crashCount) ?? 0;
      const participantCount = parseNumber(metadata?.participantCount) ?? 1;

      if (workflowSuccessPct !== null) {
        workflowSuccessValues.push(workflowSuccessPct);
      }
      if (typeof row.rating === "number") {
        ratings.push(row.rating);
      }

      totalBlockers += Math.max(0, blockerCount);
      totalCrashes += Math.max(0, crashCount);
      totalParticipants += Math.max(0, participantCount);
    }

    return {
      cohort,
      totalSessions: cohortRows.length,
      averageWorkflowSuccessPct:
        workflowSuccessValues.length > 0
          ? Number((workflowSuccessValues.reduce((sum, value) => sum + value, 0) / workflowSuccessValues.length).toFixed(2))
          : null,
      averageRating: ratings.length > 0 ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2)) : null,
      totalBlockers,
      totalCrashes,
      totalParticipants
    };
  };

  return {
    dogfood: summarize("dogfood"),
    pilot: summarize("pilot")
  };
}

function summarizeFeatureMatrixCoverage(matrix: z.infer<typeof FeatureMatrixSchema>) {
  const coveredFeatures = matrix.features.filter(
    (feature) =>
      feature.coverage.api.length > 0 &&
      feature.coverage.ui.length > 0 &&
      feature.coverage.tests.length > 0
  ).length;
  const implementedOrVerified = matrix.features.filter(
    (feature) => feature.status === "implemented" || feature.status === "verified"
  ).length;
  const verifiedCount = matrix.features.filter((feature) => feature.status === "verified").length;
  const total = matrix.features.length;

  return {
    totalFeatures: total,
    coveredFeatures,
    implementedOrVerified,
    verifiedCount,
    coveragePct: Number(((coveredFeatures / total) * 100).toFixed(2)),
    implementedOrVerifiedPct: Number(((implementedOrVerified / total) * 100).toFixed(2)),
    verifiedPct: Number(((verifiedCount / total) * 100).toFixed(2))
  };
}

async function loadFeatureMatrix() {
  const matrixPath = process.env.DESCRIPT_FEATURE_MATRIX_PATH?.trim() || "docs/parity/descript_feature_matrix.json";
  const raw = await readFile(resolve(process.cwd(), matrixPath), "utf8");
  const matrix = FeatureMatrixSchema.parse(JSON.parse(raw));
  return {
    path: matrixPath,
    matrix,
    coverage: summarizeFeatureMatrixCoverage(matrix)
  };
}

function summarizeReleaseCandidate(
  events: Array<{ action: string; metadata: Prisma.JsonValue | null; createdAt: Date }>,
  now: Date
): ReleaseCandidateState {
  const freezeEvent = events.find((event) => event.action === "parity.release_candidate.freeze");
  const unfreezeEvent = events.find((event) => event.action === "parity.release_candidate.unfreeze");
  const frozen = Boolean(
    freezeEvent && (!unfreezeEvent || freezeEvent.createdAt.getTime() > unfreezeEvent.createdAt.getTime())
  );
  const freezeMeta = asRecord(freezeEvent?.metadata ?? null);

  return {
    frozen,
    frozenAt: frozen && freezeEvent ? freezeEvent.createdAt.toISOString() : null,
    frozenDays: frozen && freezeEvent ? daysBetween(freezeEvent.createdAt, now) : 0,
    releaseTag: parseString(freezeMeta?.releaseTag),
    notes: parseString(freezeMeta?.notes)
  };
}

function summarizeDescriptDiff(params: {
  events: Array<{ metadata: Prisma.JsonValue | null; createdAt: Date }>;
  now: Date;
}) {
  const currentMonth = monthKey(params.now);
  const latest = params.events[0];
  if (!latest) {
    return {
      hasRecord: false,
      comparisonMonth: null,
      comparedAt: null,
      source: null,
      unresolvedDriftCount: 0,
      discoveredFeatureCount: 0,
      freshnessDays: null,
      currentMonth,
      meetsFreshnessWindow: false,
      meetsCurrentMonth: false,
      passed: false
    } satisfies DescriptDiffState;
  }

  const metadata = asRecord(latest.metadata ?? null);
  const comparisonMonth = parseString(metadata?.comparisonMonth) ?? monthKey(latest.createdAt);
  const comparedAtRaw = parseString(metadata?.comparedAt);
  const comparedAt = comparedAtRaw ? new Date(comparedAtRaw) : latest.createdAt;
  const unresolvedDriftCount = Math.max(0, Math.floor(parseNumber(metadata?.unresolvedDriftCount) ?? 0));
  const discoveredFeatures = Array.isArray(metadata?.discoveredFeatures) ? metadata?.discoveredFeatures.length : 0;
  const freshnessDays = daysBetween(comparedAt, params.now);
  const meetsFreshnessWindow = freshnessDays <= env.DESCRIPT_PARITY_DIFF_MAX_AGE_DAYS;
  const meetsCurrentMonth = comparisonMonth === currentMonth;
  const passed = meetsFreshnessWindow && meetsCurrentMonth && unresolvedDriftCount === 0;

  return {
    hasRecord: true,
    comparisonMonth,
    comparedAt: comparedAt.toISOString(),
    source: parseString(metadata?.source),
    unresolvedDriftCount,
    discoveredFeatureCount: discoveredFeatures,
    freshnessDays,
    currentMonth,
    meetsFreshnessWindow,
    meetsCurrentMonth,
    passed
  } satisfies DescriptDiffState;
}

function normalizeQualityCapabilities() {
  return [...new Set(
    env.DESCRIPT_PARITY_REQUIRED_QUALITY_CAPABILITIES
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  )];
}

export function computeConsecutivePassDays(entries: CertificationHistoryEntry[], now = new Date()) {
  const latestByDay = new Map<string, CertificationHistoryEntry>();

  for (const entry of entries) {
    const key = dateKey(entry.createdAt);
    const existing = latestByDay.get(key);
    if (!existing || existing.createdAt.getTime() < entry.createdAt.getTime()) {
      latestByDay.set(key, entry);
    }
  }

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let streak = 0;

  for (let offset = 0; offset < 120; offset += 1) {
    const cursor = new Date(start.getTime() - offset * 24 * 60 * 60 * 1000);
    const dayEntry = latestByDay.get(dateKey(cursor));
    if (!dayEntry?.passed) {
      break;
    }
    streak += 1;
  }

  return streak;
}

async function syncCertificationIncident(params: {
  workspaceId: string;
  passed: boolean;
  readout: Record<string, unknown>;
}) {
  const category = "DESCRIPT_PHASE6_CERTIFICATION";
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

  const dimensions = Array.isArray(params.readout.dimensions)
    ? (params.readout.dimensions as Array<Record<string, unknown>>)
    : [];
  const failedDimensions = dimensions.filter((dimension) => dimension.passed !== true);
  const failedDimensionIds = failedDimensions
    .map((dimension) => parseString(dimension.id))
    .filter((value): value is string => Boolean(value));
  const operationalDimension = dimensions.find((dimension) => parseString(dimension.id) === "operational_parity");
  const operationalEvidence = asRecord(operationalDimension?.evidence);
  const releaseCandidate = asRecord(operationalEvidence?.releaseCandidate);
  const diff = asRecord(operationalEvidence?.diff);
  const dogfood = asRecord(operationalEvidence?.dogfood);
  const pilot = asRecord(operationalEvidence?.pilot);
  const openHighOrCriticalIncidents = parseNumber(operationalEvidence?.openHighOrCriticalIncidents) ?? 0;
  const dogfoodSessions = parseNumber(dogfood?.totalSessions) ?? 0;
  const pilotSessions = parseNumber(pilot?.totalSessions) ?? 0;
  const totalBlockers = (parseNumber(dogfood?.totalBlockers) ?? 0) + (parseNumber(pilot?.totalBlockers) ?? 0);
  const totalCrashes = (parseNumber(dogfood?.totalCrashes) ?? 0) + (parseNumber(pilot?.totalCrashes) ?? 0);
  const temporalHoldOnly =
    !params.passed &&
    failedDimensionIds.every((id) => id === "operational_parity") &&
    parseBoolean(diff?.passed) === true &&
    parseBoolean(releaseCandidate?.frozen) === true &&
    openHighOrCriticalIncidents === 0 &&
    dogfoodSessions >= env.DESCRIPT_PARITY_DOGFOOD_MIN_SESSIONS &&
    pilotSessions >= env.DESCRIPT_PARITY_PILOT_MIN_SESSIONS &&
    totalBlockers === 0 &&
    totalCrashes === 0 &&
    (parseNumber(releaseCandidate?.frozenDays) ?? 0) < env.DESCRIPT_PARITY_DOGFOOD_MIN_DAYS;

  if (!params.passed) {
    if (temporalHoldOnly) {
      if (active) {
        await prisma.systemIncident.update({
          where: { id: active.id },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            summary: "Phase 6 certification in temporal hold window",
            metadata: {
              temporalHoldOnly: true,
              readout: params.readout
            } as Prisma.InputJsonValue
          }
        });
      }
      return;
    }

    const metadata = {
      readout: params.readout,
      failedDimensions
    } as Prisma.InputJsonValue;

    if (active) {
      await prisma.systemIncident.update({
        where: { id: active.id },
        data: {
          severity: "HIGH",
          summary: "Phase 6 certification gate failed",
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
        summary: "Phase 6 certification gate failed",
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
        summary: "Phase 6 certification gate recovered",
        metadata: {
          recovered: true,
          readout: params.readout
        } as Prisma.InputJsonValue
      }
    });
  }
}

export async function getLatestDescriptDiffStatus(workspaceId: string, now = new Date()) {
  const events = await prisma.auditEvent.findMany({
    where: {
      workspaceId,
      action: "parity.descript_diff.recorded"
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 12,
    select: {
      metadata: true,
      createdAt: true
    }
  });

  return summarizeDescriptDiff({
    events,
    now
  });
}

export async function getReleaseCandidateStatus(workspaceId: string, now = new Date()) {
  const events = await prisma.auditEvent.findMany({
    where: {
      workspaceId,
      action: {
        in: ["parity.release_candidate.freeze", "parity.release_candidate.unfreeze"]
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 20,
    select: {
      action: true,
      metadata: true,
      createdAt: true
    }
  });

  return summarizeReleaseCandidate(events, now);
}

export async function buildPhase6CertificationReadout(params: {
  workspaceId: string;
  runByUserId?: string;
  persistRun?: boolean;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const feedbackCutoff = new Date(now.getTime() - Math.max(30, env.DESCRIPT_PARITY_DOGFOOD_MIN_DAYS + 16) * 24 * 60 * 60 * 1000);
  const requiredQualityCapabilities = normalizeQualityCapabilities();

  const [
    scorecard,
    launchReadiness,
    qualityMetrics,
    matrixPayload,
    publishByStatus,
    pendingReviewRequests,
    reviewDecisionLogs30d,
    activeShareLinks,
    openHighOrCriticalIncidents,
    latestBenchmark,
    pilotFeedbackRows,
    diffEvents,
    releaseEvents,
    historyEvents
  ] = await Promise.all([
    buildParityScorecardForWorkspace(params.workspaceId),
    buildDescriptPlusLaunchReadiness({
      workspaceId: params.workspaceId,
      persistIncident: false
    }),
    summarizeQualityMetrics(300),
    loadFeatureMatrix(),
    prisma.publishConnectorJob.groupBy({
      by: ["status"],
      where: {
        workspaceId: params.workspaceId,
        createdAt: {
          gte: cutoff30d
        }
      },
      _count: {
        _all: true
      }
    }),
    prisma.reviewRequest.count({
      where: {
        workspaceId: params.workspaceId,
        status: "PENDING"
      }
    }),
    prisma.reviewDecisionLog.count({
      where: {
        workspaceId: params.workspaceId,
        createdAt: {
          gte: cutoff30d
        }
      }
    }),
    prisma.shareLink.count({
      where: {
        workspaceId: params.workspaceId,
        revokedAt: null,
        OR: [
          { expiresAt: null },
          {
            expiresAt: {
              gt: now
            }
          }
        ]
      }
    }),
    prisma.systemIncident.count({
      where: {
        workspaceId: params.workspaceId,
        status: "OPEN",
        severity: {
          in: ["HIGH", "CRITICAL"]
        }
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
    }),
    prisma.qualityFeedback.findMany({
      where: {
        workspaceId: params.workspaceId,
        category: {
          in: ["phase6.dogfood.session", "phase6.pilot.session"]
        },
        createdAt: {
          gte: feedbackCutoff
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        category: true,
        rating: true,
        metadata: true
      }
    }),
    prisma.auditEvent.findMany({
      where: {
        workspaceId: params.workspaceId,
        action: "parity.descript_diff.recorded"
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 12,
      select: {
        metadata: true,
        createdAt: true
      }
    }),
    prisma.auditEvent.findMany({
      where: {
        workspaceId: params.workspaceId,
        action: {
          in: ["parity.release_candidate.freeze", "parity.release_candidate.unfreeze"]
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 20,
      select: {
        action: true,
        metadata: true,
        createdAt: true
      }
    }),
    prisma.auditEvent.findMany({
      where: {
        workspaceId: params.workspaceId,
        action: "parity.certification.run",
        createdAt: {
          gte: new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000)
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 400,
      select: {
        createdAt: true,
        metadata: true
      }
    })
  ]);

  const matrixCoverage = matrixPayload.coverage;
  const requiredBaselineDate = env.DESCRIPT_PARITY_BASELINE_DATE;
  const featureMatrixPassed =
    matrixCoverage.coveragePct === 100 &&
    matrixCoverage.implementedOrVerifiedPct === 100 &&
    matrixPayload.matrix.baselineDate === requiredBaselineDate;

  const pilotFeedback = summarizePilotFeedback(pilotFeedbackRows);
  const combinedWorkflowSessions = pilotFeedback.dogfood.totalSessions + pilotFeedback.pilot.totalSessions;
  const combinedWorkflowSuccessValues = [
    pilotFeedback.dogfood.averageWorkflowSuccessPct,
    pilotFeedback.pilot.averageWorkflowSuccessPct
  ].filter((value): value is number => typeof value === "number");
  const combinedWorkflowSuccessPct =
    combinedWorkflowSuccessValues.length > 0
      ? Number((combinedWorkflowSuccessValues.reduce((sum, value) => sum + value, 0) / combinedWorkflowSuccessValues.length).toFixed(2))
      : null;
  const combinedBlockers = pilotFeedback.dogfood.totalBlockers + pilotFeedback.pilot.totalBlockers;
  const workflowParityPassed =
    scorecard.modules.every((module) => module.passed) &&
    combinedWorkflowSessions >= env.DESCRIPT_PARITY_DOGFOOD_MIN_SESSIONS + env.DESCRIPT_PARITY_PILOT_MIN_SESSIONS &&
    combinedWorkflowSuccessPct === 100 &&
    combinedBlockers === 0;

  const uxSloPassed =
    launchReadiness.guardrails.triggers.length === 0 &&
    launchReadiness.guardrails.shouldRollback === false &&
    launchReadiness.guardrails.status === "READY";

  const latestByCapability = new Map(
    qualityMetrics.latestByCapability.map((run) => [run.capability.toLowerCase(), run])
  );
  const qualityCapabilityChecks = requiredQualityCapabilities.map((capability) => {
    const run = latestByCapability.get(capability);
    const passed = Boolean(run && run.passed);
    return {
      capability,
      hasRun: Boolean(run),
      passed,
      runId: run?.id ?? null,
      createdAt: run?.createdAt ? new Date(run.createdAt).toISOString() : null
    };
  });
  const qualityParityPassed = qualityCapabilityChecks.every((check) => check.hasRun && check.passed);

  const publishTotal = publishByStatus.reduce((sum, row) => sum + row._count._all, 0);
  const publishDone = publishByStatus.find((row) => row.status === "DONE")?._count._all ?? 0;
  const publishError = publishByStatus.find((row) => row.status === "ERROR")?._count._all ?? 0;
  const publishSuccessPct = publishTotal > 0 ? Number(((publishDone / publishTotal) * 100).toFixed(2)) : 0;
  const ecosystemParityPassed =
    publishTotal > 0 &&
    publishError === 0 &&
    publishSuccessPct === 100 &&
    pendingReviewRequests === 0 &&
    reviewDecisionLogs30d > 0 &&
    activeShareLinks > 0;

  const releaseCandidate = summarizeReleaseCandidate(releaseEvents, now);
  const diffState = summarizeDescriptDiff({
    events: diffEvents,
    now
  });
  const operationalParityPassed =
    openHighOrCriticalIncidents === 0 &&
    diffState.passed &&
    releaseCandidate.frozen &&
    releaseCandidate.frozenDays >= env.DESCRIPT_PARITY_DOGFOOD_MIN_DAYS &&
    pilotFeedback.dogfood.totalSessions >= env.DESCRIPT_PARITY_DOGFOOD_MIN_SESSIONS &&
    pilotFeedback.pilot.totalSessions >= env.DESCRIPT_PARITY_PILOT_MIN_SESSIONS &&
    combinedBlockers === 0 &&
    (pilotFeedback.dogfood.totalCrashes + pilotFeedback.pilot.totalCrashes) === 0;

  const dimensions: CertificationDimensionResult[] = [
    {
      id: "feature_matrix",
      label: "Feature Matrix Coverage",
      passed: featureMatrixPassed,
      summary: featureMatrixPassed
        ? "All matrix features are implemented with complete API/UI/test evidence."
        : "Feature matrix has missing coverage, status drift, or baseline-date mismatch.",
      evidence: {
        path: matrixPayload.path,
        competitor: matrixPayload.matrix.competitor,
        baselineDate: matrixPayload.matrix.baselineDate,
        requiredBaselineDate,
        ...matrixCoverage
      }
    },
    {
      id: "workflow_parity",
      label: "Workflow Parity",
      passed: workflowParityPassed,
      summary: workflowParityPassed
        ? "Top workflows pass with zero blockers and perfect completion in pilot cohorts."
        : "Workflow parity is below target due to module gaps, insufficient sessions, blockers, or completion loss.",
      evidence: {
        scorecardPassRate: scorecard.passRate,
        allModulesPassed: scorecard.modules.every((module) => module.passed),
        combinedWorkflowSessions,
        combinedWorkflowSuccessPct,
        combinedBlockers,
        dogfood: pilotFeedback.dogfood,
        pilot: pilotFeedback.pilot
      }
    },
    {
      id: "ux_slo_parity",
      label: "UX/SLO Parity",
      passed: uxSloPassed,
      summary: uxSloPassed
        ? "Launch guardrails are green with no rollback triggers."
        : "Launch guardrails are not green; UX/SLO parity is not certified.",
      evidence: {
        stage: launchReadiness.stage,
        status: launchReadiness.guardrails.status,
        triggerCount: launchReadiness.guardrails.triggers.length,
        triggers: launchReadiness.guardrails.triggers,
        snapshot: launchReadiness.snapshot,
        thresholds: launchReadiness.thresholds
      }
    },
    {
      id: "quality_parity",
      label: "Quality Parity",
      passed: qualityParityPassed,
      summary: qualityParityPassed
        ? "All required quality capability gates have recent passing eval runs."
        : "One or more required quality capabilities are missing or failing eval gates.",
      evidence: {
        requiredCapabilities: requiredQualityCapabilities,
        checks: qualityCapabilityChecks
      }
    },
    {
      id: "ecosystem_parity",
      label: "Ecosystem Parity",
      passed: ecosystemParityPassed,
      summary: ecosystemParityPassed
        ? "Publishing, review, and sharing workflows are all green in the validation window."
        : "Publishing/review/share ecosystem parity has unresolved failures or coverage gaps.",
      evidence: {
        publishTotal,
        publishDone,
        publishError,
        publishSuccessPct,
        pendingReviewRequests,
        reviewDecisionLogs30d,
        activeShareLinks
      }
    },
    {
      id: "operational_parity",
      label: "Operational Parity",
      passed: operationalParityPassed,
      summary: operationalParityPassed
        ? "Release candidate freeze, drift controls, incident posture, and pilot hardening pass."
        : "Operational hardening has unresolved incidents, drift, freeze, or pilot-readiness gaps.",
      evidence: {
        openHighOrCriticalIncidents,
        diff: diffState,
        releaseCandidate,
        dogfood: pilotFeedback.dogfood,
        pilot: pilotFeedback.pilot
      }
    }
  ];

  const overallPassed = dimensions.every((dimension) => dimension.passed);
  const historyEntries: CertificationHistoryEntry[] = historyEvents.map((event) => {
    const metadata = asRecord(event.metadata ?? null);
    return {
      createdAt: event.createdAt,
      passed: parseBoolean(metadata?.overallPassed) ?? false
    };
  });

  const projectedHistoryEntries = [
    ...historyEntries,
    {
      createdAt: now,
      passed: overallPassed
    }
  ];
  const consecutivePassDays = computeConsecutivePassDays(projectedHistoryEntries, now);
  const streakTargetDays = env.DESCRIPT_PARITY_STREAK_DAYS_REQUIRED;
  const streakPassed = consecutivePassDays >= streakTargetDays;

  const benchmarkSummary = asRecord(latestBenchmark?.summary ?? null);
  const readout = {
    workspaceId: params.workspaceId,
    generatedAt: now.toISOString(),
    baselineDate: matrixPayload.matrix.baselineDate,
    requiredBaselineDate,
    overallPassed,
    certificationPassed: overallPassed && streakPassed,
    dimensions,
    streak: {
      consecutivePassDays,
      targetDays: streakTargetDays,
      passed: streakPassed
    },
    scorecard: {
      overallScore: scorecard.overallScore,
      passRate: scorecard.passRate,
      passedModules: scorecard.passedModules,
      totalModules: scorecard.totalModules
    },
    launchReadiness: {
      stage: launchReadiness.stage,
      status: launchReadiness.guardrails.status,
      shouldRollback: launchReadiness.guardrails.shouldRollback,
      triggerCount: launchReadiness.guardrails.triggers.length
    },
    latestBenchmark: latestBenchmark
      ? {
          id: latestBenchmark.id,
          createdAt: latestBenchmark.createdAt.toISOString(),
          finishedAt: latestBenchmark.finishedAt?.toISOString() ?? null,
          betterThanDescript: parseBoolean(benchmarkSummary?.betterThanDescript),
          summary: benchmarkSummary
        }
      : null,
    monthlyDiff: diffState,
    releaseCandidate,
    pilotFeedback
  };

  if (params.persistRun) {
    await prisma.auditEvent.create({
      data: {
        workspaceId: params.workspaceId,
        actorUserId: params.runByUserId,
        action: "parity.certification.run",
        targetType: "PARITY_CERTIFICATION",
        targetId: null,
        severity: readout.certificationPassed ? "INFO" : "HIGH",
        metadata: {
          ...readout,
          dimensions: dimensions.map((dimension) => ({
            id: dimension.id,
            passed: dimension.passed,
            summary: dimension.summary
          }))
        } as Prisma.InputJsonValue
      }
    });

    await syncCertificationIncident({
      workspaceId: params.workspaceId,
      passed: readout.certificationPassed,
      readout
    });
  }

  return readout;
}

export async function recordDescriptDiff(params: {
  workspaceId: string;
  userId: string;
  payload: z.infer<typeof DescriptDiffRecordSchema>;
}) {
  const normalizedPayload = DescriptDiffRecordSchema.parse(params.payload);
  await prisma.auditEvent.create({
    data: {
      workspaceId: params.workspaceId,
      actorUserId: params.userId,
      action: "parity.descript_diff.recorded",
      targetType: "PARITY_DIFF",
      targetId: normalizedPayload.comparisonMonth,
      severity: normalizedPayload.unresolvedDriftCount > 0 ? "WARN" : "INFO",
      metadata: {
        ...normalizedPayload,
        comparedAt: new Date().toISOString()
      } as Prisma.InputJsonValue
    }
  });

  return getLatestDescriptDiffStatus(params.workspaceId);
}

export async function freezeReleaseCandidate(params: {
  workspaceId: string;
  userId: string;
  payload: z.infer<typeof ReleaseCandidateFreezeSchema>;
}) {
  const body = ReleaseCandidateFreezeSchema.parse(params.payload);
  await prisma.auditEvent.create({
    data: {
      workspaceId: params.workspaceId,
      actorUserId: params.userId,
      action: "parity.release_candidate.freeze",
      targetType: "PARITY_RELEASE_CANDIDATE",
      targetId: body.releaseTag,
      severity: "INFO",
      metadata: body as Prisma.InputJsonValue
    }
  });
  return getReleaseCandidateStatus(params.workspaceId);
}

export async function unfreezeReleaseCandidate(params: {
  workspaceId: string;
  userId: string;
  payload: z.infer<typeof ReleaseCandidateUnfreezeSchema>;
}) {
  const body = ReleaseCandidateUnfreezeSchema.parse(params.payload);
  await prisma.auditEvent.create({
    data: {
      workspaceId: params.workspaceId,
      actorUserId: params.userId,
      action: "parity.release_candidate.unfreeze",
      targetType: "PARITY_RELEASE_CANDIDATE",
      severity: "WARN",
      metadata: body as Prisma.InputJsonValue
    }
  });
  return getReleaseCandidateStatus(params.workspaceId);
}

export async function recordPhase6PilotFeedback(params: {
  workspaceId: string;
  userId: string;
  payload: z.infer<typeof Phase6PilotFeedbackSchema>;
}) {
  const body = Phase6PilotFeedbackSchema.parse(params.payload);
  const category = body.cohort === "dogfood" ? "phase6.dogfood.session" : "phase6.pilot.session";

  const feedback = await prisma.qualityFeedback.create({
    data: {
      workspaceId: params.workspaceId,
      category,
      rating: body.rating,
      comment: body.notes,
      createdByUserId: params.userId,
      metadata: {
        sessionId: body.sessionId,
        workflowSuccessPct: body.workflowSuccessPct,
        blockerCount: body.blockerCount,
        crashCount: body.crashCount,
        participantCount: body.participantCount
      } as Prisma.InputJsonValue
    }
  });

  await prisma.auditEvent.create({
    data: {
      workspaceId: params.workspaceId,
      actorUserId: params.userId,
      action: "parity.phase6.pilot_feedback.recorded",
      targetType: "PARITY_PILOT_FEEDBACK",
      targetId: feedback.id,
      severity: body.blockerCount > 0 || body.crashCount > 0 ? "WARN" : "INFO",
      metadata: {
        cohort: body.cohort,
        sessionId: body.sessionId,
        workflowSuccessPct: body.workflowSuccessPct,
        blockerCount: body.blockerCount,
        crashCount: body.crashCount,
        participantCount: body.participantCount,
        rating: body.rating ?? null
      } as Prisma.InputJsonValue
    }
  });

  return {
    id: feedback.id,
    cohort: body.cohort,
    recordedAt: feedback.createdAt.toISOString()
  };
}
