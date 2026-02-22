import { requireUserWithWorkspace } from "@/lib/api-context";
import { creditPacks, planCatalog } from "@/lib/billing/catalog";
import { buildUsageAlerts } from "@/lib/billing/usage-alerts";
import { listWorkspaceUsageAnomalies } from "@/lib/billing/anomalies";
import { getCreditBalance, listLedgerEntries } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { workspace } = await requireUserWithWorkspace();
    const [balance, activeSubscription, entries, openAnomalies] = await Promise.all([
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
      recentEntries: entries,
      anomalies: openAnomalies
        .filter((anomaly) => anomaly.status === "OPEN" || anomaly.status === "ACKNOWLEDGED")
        .map((anomaly) => ({
          id: anomaly.id,
          feature: anomaly.feature,
          severity: anomaly.severity,
          summary: anomaly.summary,
          createdAt: anomaly.createdAt
        }))
    });

    const byFeature: Record<string, number> = {};
    for (const entry of entries) {
      if (entry.amount >= 0) {
        continue;
      }
      byFeature[entry.feature] = (byFeature[entry.feature] ?? 0) + Math.abs(entry.amount);
    }

    return jsonOk({
      workspaceId: workspace.id,
      balance,
      subscription: activeSubscription
        ? {
            id: activeSubscription.id,
            status: activeSubscription.status,
            currentPeriodStart: activeSubscription.currentPeriodStart,
            currentPeriodEnd: activeSubscription.currentPeriodEnd,
            plan: activeSubscription.plan
              ? {
                  id: activeSubscription.plan.id,
                  tier: activeSubscription.plan.tier,
                  name: activeSubscription.plan.name,
                  monthlyCredits: activeSubscription.plan.monthlyCredits
                }
              : null
          }
        : null,
      usage: {
        ...usage.metrics,
        byFeature,
        alerts: usage.alerts,
        anomalies: openAnomalies.slice(0, 10).map((anomaly) => ({
          id: anomaly.id,
          feature: anomaly.feature,
          severity: anomaly.severity,
          status: anomaly.status,
          summary: anomaly.summary,
          createdAt: anomaly.createdAt
        }))
      },
      plans: planCatalog,
      creditPacks
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
