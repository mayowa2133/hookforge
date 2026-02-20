import { prisma } from "@/lib/prisma";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    const started = Date.now();

    await prisma.$queryRaw`SELECT 1`;

    const [openCriticalAnomalies, activeEvalRuns] = await Promise.all([
      prisma.usageAnomaly.count({
        where: {
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
          severity: "CRITICAL"
        }
      }),
      prisma.qualityEvalRun.count({
        where: {
          status: { in: ["QUEUED", "RUNNING"] }
        }
      })
    ]);

    const latencyMs = Date.now() - started;

    return jsonOk({
      ok: openCriticalAnomalies === 0,
      checkedAt: new Date().toISOString(),
      latencyMs,
      services: {
        api: "ok",
        database: "ok",
        qualityEvalQueueDepth: activeEvalRuns
      },
      anomalies: {
        criticalOpen: openCriticalAnomalies
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
