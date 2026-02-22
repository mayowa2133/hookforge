import { addLedgerEntry, ensureCreditWallet } from "@/lib/credits";
import { prisma } from "@/lib/prisma";
import { scanUsageAnomaliesForWorkspace } from "./anomalies";

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function summarizeLedgerIntegrity(params: {
  walletBalance: number;
  ledgerNetAmount: number;
}) {
  const mismatch = params.walletBalance - params.ledgerNetAmount;
  return {
    walletBalance: params.walletBalance,
    ledgerNetAmount: params.ledgerNetAmount,
    mismatch,
    reconciliationRatePct: mismatch === 0 ? 100 : 0
  };
}

export async function reconcileWorkspaceBillingState(params: {
  workspaceId: string;
  actorUserId: string;
  repairWalletMismatch?: boolean;
}) {
  const wallet = await ensureCreditWallet(params.workspaceId);
  const now = new Date();

  const [ledgerAggregate, activeSubscriptions] = await Promise.all([
    prisma.creditLedgerEntry.aggregate({
      where: { workspaceId: params.workspaceId },
      _sum: { amount: true }
    }),
    prisma.subscription.findMany({
      where: {
        workspaceId: params.workspaceId,
        status: "ACTIVE"
      },
      include: { plan: true },
      orderBy: { createdAt: "desc" }
    })
  ]);

  const ledgerNetAmount = ledgerAggregate._sum.amount ?? 0;
  const integrity = summarizeLedgerIntegrity({
    walletBalance: wallet.balance,
    ledgerNetAmount
  });

  let repaired = false;
  if (params.repairWalletMismatch && integrity.mismatch !== 0) {
    await prisma.creditWallet.update({
      where: { workspaceId: params.workspaceId },
      data: {
        balance: ledgerNetAmount
      }
    });
    repaired = true;
  }

  if (integrity.mismatch !== 0) {
    const windowStart = startOfUtcDay(now);
    await prisma.usageAnomaly.create({
      data: {
        workspaceId: params.workspaceId,
        feature: "billing.ledger_reconciliation",
        windowStart,
        windowEnd: addDays(windowStart, 1),
        severity: "CRITICAL",
        status: "OPEN",
        expectedAmount: ledgerNetAmount,
        actualAmount: wallet.balance,
        deviationPct: Math.abs(integrity.mismatch),
        summary: `Wallet mismatch detected (${integrity.mismatch} credits).`,
        metadata: {
          repaired,
          repairRequested: Boolean(params.repairWalletMismatch),
          actorUserId: params.actorUserId
        }
      }
    });
  }

  let canceledDuplicateSubscriptions = 0;
  let renewedSubscriptions = 0;

  if (activeSubscriptions.length > 1) {
    const [primary, ...duplicates] = activeSubscriptions;
    if (duplicates.length > 0) {
      const duplicateIds = duplicates.map((item) => item.id);
      await prisma.subscription.updateMany({
        where: {
          id: { in: duplicateIds }
        },
        data: {
          status: "CANCELED",
          currentPeriodEnd: now
        }
      });
      canceledDuplicateSubscriptions = duplicates.length;
    }

    if (primary.planId) {
      await prisma.plan.updateMany({
        where: {
          workspaceId: params.workspaceId,
          id: {
            not: primary.planId
          },
          status: "ACTIVE"
        },
        data: {
          status: "PAUSED"
        }
      });
    }
  }

  const activeSubscription = await prisma.subscription.findFirst({
    where: {
      workspaceId: params.workspaceId,
      status: "ACTIVE"
    },
    include: { plan: true },
    orderBy: { createdAt: "desc" }
  });

  const currentPeriodEnd = activeSubscription?.currentPeriodEnd ?? null;
  if (activeSubscription?.plan && currentPeriodEnd && currentPeriodEnd <= now) {
    const cycleStart = currentPeriodEnd;
    const cycleEnd = addDays(cycleStart, 30);
    const cycleReferenceId = `${activeSubscription.id}:${cycleStart.toISOString()}`;
    const existingCycleCredit = await prisma.creditLedgerEntry.findFirst({
      where: {
        workspaceId: params.workspaceId,
        feature: "subscription.monthly_allocation",
        referenceType: "SubscriptionCycle",
        referenceId: cycleReferenceId
      },
      select: { id: true }
    });

    if (!existingCycleCredit) {
      await addLedgerEntry({
        workspaceId: params.workspaceId,
        feature: "subscription.monthly_allocation",
        amount: activeSubscription.plan.monthlyCredits,
        entryType: "CREDIT",
        referenceType: "SubscriptionCycle",
        referenceId: cycleReferenceId,
        metadata: {
          renewedBy: params.actorUserId,
          subscriptionId: activeSubscription.id
        }
      });
      renewedSubscriptions += 1;
    }

    await prisma.subscription.update({
      where: { id: activeSubscription.id },
      data: {
        currentPeriodStart: cycleStart,
        currentPeriodEnd: cycleEnd
      }
    });
  }

  const scan = await scanUsageAnomaliesForWorkspace({
    workspaceId: params.workspaceId
  });

  const openCriticalBillingAnomalies = await prisma.usageAnomaly.count({
    where: {
      workspaceId: params.workspaceId,
      status: {
        in: ["OPEN", "ACKNOWLEDGED"]
      },
      severity: "CRITICAL"
    }
  });

  return {
    workspaceId: params.workspaceId,
    integrity: {
      ...integrity,
      repaired
    },
    lifecycle: {
      canceledDuplicateSubscriptions,
      renewedSubscriptions
    },
    anomalies: {
      detectedCount: scan.detected.length,
      openCriticalCount: openCriticalBillingAnomalies
    },
    qualityGate: {
      ledgerReconciliationRate: integrity.mismatch === 0 || repaired ? 100 : 0,
      criticalBillingDefects: openCriticalBillingAnomalies
    }
  };
}
