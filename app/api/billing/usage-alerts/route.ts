import { requireWorkspaceCapability } from "@/lib/api-context";
import { listWorkspaceUsageAnomalies } from "@/lib/billing/anomalies";
import { buildUsageAlerts } from "@/lib/billing/usage-alerts";
import { getCreditBalance, listLedgerEntries } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "billing.read",
      request
    });
    const [balance, activeSubscription, recentEntries, anomalies] = await Promise.all([
      getCreditBalance(workspace.id),
      prisma.subscription.findFirst({
        where: {
          workspaceId: workspace.id,
          status: "ACTIVE"
        },
        include: {
          plan: true
        },
        orderBy: {
          createdAt: "desc"
        }
      }),
      listLedgerEntries(workspace.id, 80),
      listWorkspaceUsageAnomalies({
        workspaceId: workspace.id,
        take: 20
      })
    ]);

    const usage = buildUsageAlerts({
      balance,
      monthlyCredits: activeSubscription?.plan?.monthlyCredits ?? null,
      recentEntries,
      anomalies: anomalies
        .filter((anomaly) => anomaly.status === "OPEN" || anomaly.status === "ACKNOWLEDGED")
        .map((anomaly) => ({
          id: anomaly.id,
          feature: anomaly.feature,
          severity: anomaly.severity,
          summary: anomaly.summary,
          createdAt: anomaly.createdAt
        }))
    });

    return jsonOk({
      workspaceId: workspace.id,
      balance,
      alerts: usage.alerts,
      metrics: usage.metrics,
      anomalies: anomalies.map((anomaly) => ({
        id: anomaly.id,
        feature: anomaly.feature,
        severity: anomaly.severity,
        status: anomaly.status,
        summary: anomaly.summary,
        createdAt: anomaly.createdAt
      }))
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
