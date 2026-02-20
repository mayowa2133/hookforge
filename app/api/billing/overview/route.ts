import { requireUserWithWorkspace } from "@/lib/api-context";
import { creditPacks, planCatalog } from "@/lib/billing/catalog";
import { buildUsageAlerts } from "@/lib/billing/usage-alerts";
import { getCreditBalance, listLedgerEntries } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { workspace } = await requireUserWithWorkspace();
    const [balance, activeSubscription, entries] = await Promise.all([
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
      listLedgerEntries(workspace.id, 80)
    ]);

    const usage = buildUsageAlerts({
      balance,
      monthlyCredits: activeSubscription?.plan?.monthlyCredits ?? null,
      recentEntries: entries
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
        alerts: usage.alerts
      },
      plans: planCatalog,
      creditPacks
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
