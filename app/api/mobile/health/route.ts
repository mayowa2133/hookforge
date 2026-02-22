import { prisma } from "@/lib/prisma";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { readMobileTelemetrySnapshot, summarizeMobileTelemetry } from "@/lib/mobile/telemetry";

export const runtime = "nodejs";

export async function GET() {
  try {
    const started = Date.now();

    await prisma.$queryRaw`SELECT 1`;

    const [openCriticalAnomalies, blockingCriticalAnomalies, activeEvalRuns] = await Promise.all([
      prisma.usageAnomaly.count({
        where: {
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
          severity: "CRITICAL"
        }
      }),
      prisma.usageAnomaly.count({
        where: {
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
          severity: "CRITICAL",
          feature: "billing.ledger_reconciliation"
        }
      }),
      prisma.qualityEvalRun.count({
        where: {
          status: { in: ["QUEUED", "RUNNING"] }
        }
      })
    ]);

    let mobileSummary = {
      crashFreeSessionsPct: 100,
      topWorkflowGapPct: 0,
      meetsCrashFreeTarget: true,
      meetsWorkflowGapTarget: true,
      workflowSummaries: [] as Array<{
        id: string;
        title: string;
        webBaselineCompletionRatePct: number;
        mobileCompletionRatePct: number;
        completionGapPct: number;
        started: number;
        completed: number;
        avgLatencyMs: number;
      }>
    };
    let telemetryServiceStatus: "ok" | "degraded" = "ok";

    try {
      const telemetry = await readMobileTelemetrySnapshot();
      mobileSummary = summarizeMobileTelemetry(telemetry);
    } catch {
      telemetryServiceStatus = "degraded";
    }

    const latencyMs = Date.now() - started;
    const ok = mobileSummary.meetsCrashFreeTarget && mobileSummary.meetsWorkflowGapTarget;

    return jsonOk({
      ok,
      checkedAt: new Date().toISOString(),
      latencyMs,
      services: {
        api: "ok",
        database: "ok",
        qualityEvalQueueDepth: activeEvalRuns,
        mobileTelemetry: telemetryServiceStatus
      },
      anomalies: {
        criticalOpen: openCriticalAnomalies,
        criticalBlocking: blockingCriticalAnomalies
      },
      mobile: {
        crashFreeSessionsPct: mobileSummary.crashFreeSessionsPct,
        crashFreeTargetPct: 99.5,
        meetsCrashFreeTarget: mobileSummary.meetsCrashFreeTarget,
        topWorkflowGapPct: mobileSummary.topWorkflowGapPct,
        maxWorkflowGapTargetPct: 10,
        meetsWorkflowGapTarget: mobileSummary.meetsWorkflowGapTarget,
        workflows: mobileSummary.workflowSummaries
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
