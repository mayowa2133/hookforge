import { requireUserWithWorkspace } from "@/lib/api-context";
import { buildUsageAlerts } from "@/lib/billing/usage-alerts";
import { getCreditBalance, listLedgerEntries } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { workspace } = await requireUserWithWorkspace();
    const [balance, activeSubscription, recentEntries] = await Promise.all([
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
      recentEntries
    });

    return jsonOk({
      workspaceId: workspace.id,
      balance,
      alerts: usage.alerts,
      metrics: usage.metrics
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
