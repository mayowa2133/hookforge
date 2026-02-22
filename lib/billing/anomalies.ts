import type { UsageAnomaly, UsageAnomalySeverity, UsageAnomalyStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type FeatureSpendSnapshot = {
  feature: string;
  actualAmount: number;
  expectedAmount: number;
  deviationPct: number;
};

export function classifyUsageAnomaly(snapshot: FeatureSpendSnapshot): UsageAnomalySeverity | null {
  const actual = Math.max(0, Math.trunc(snapshot.actualAmount));
  const expected = Math.max(0, Math.trunc(snapshot.expectedAmount));
  const deviationPct = Number.isFinite(snapshot.deviationPct) ? snapshot.deviationPct : 0;

  if (actual >= Math.max(2000, expected * 4) || deviationPct >= 300) {
    return "CRITICAL";
  }
  if (actual >= Math.max(1200, expected * 3) || deviationPct >= 180) {
    return "HIGH";
  }
  if (actual >= Math.max(600, expected * 2) || deviationPct >= 90) {
    return "MEDIUM";
  }
  return null;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

type SpendAggregation = {
  feature: string;
  currentAmount: number;
  baselineAmount: number;
  expectedAmount: number;
  actualAmount: number;
  deviationPct: number;
};

function aggregateFeatureSpend(params: {
  entries: Array<{ feature: string; amount: number; createdAt: Date }>;
  windowStart: Date;
}) {
  const map = new Map<string, { current: number; baseline: number }>();

  for (const entry of params.entries) {
    const amount = Math.abs(Math.trunc(entry.amount));
    const key = entry.feature;
    const current = map.get(key) ?? { current: 0, baseline: 0 };
    if (entry.createdAt >= params.windowStart) {
      current.current += amount;
    } else {
      current.baseline += amount;
    }
    map.set(key, current);
  }

  const rows: SpendAggregation[] = [];
  for (const [feature, value] of map.entries()) {
    const expectedAmount = Math.max(100, Math.round(value.baseline / 7));
    const actualAmount = value.current;
    const deviationPct = expectedAmount === 0 ? 0 : Number((((actualAmount - expectedAmount) / expectedAmount) * 100).toFixed(2));
    rows.push({
      feature,
      currentAmount: value.current,
      baselineAmount: value.baseline,
      expectedAmount,
      actualAmount,
      deviationPct
    });
  }
  return rows;
}

export async function scanUsageAnomaliesForWorkspace(params: {
  workspaceId: string;
  now?: Date;
  featureFilter?: string;
}) {
  const now = params.now ?? new Date();
  const windowStart = startOfUtcDay(now);
  const windowEnd = endOfUtcDay(now);
  const baselineStart = new Date(windowStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const entries = await prisma.creditLedgerEntry.findMany({
    where: {
      workspaceId: params.workspaceId,
      amount: { lt: 0 },
      createdAt: {
        gte: baselineStart,
        lt: now
      },
      ...(params.featureFilter ? { feature: params.featureFilter } : {})
    },
    select: {
      feature: true,
      amount: true,
      createdAt: true
    }
  });

  const spendRows = aggregateFeatureSpend({
    entries,
    windowStart
  });

  const detected: UsageAnomaly[] = [];
  for (const row of spendRows) {
    const severity = classifyUsageAnomaly({
      feature: row.feature,
      actualAmount: row.actualAmount,
      expectedAmount: row.expectedAmount,
      deviationPct: row.deviationPct
    });

    if (!severity) {
      continue;
    }

    const summary = `${row.feature} spend spike: ${row.actualAmount} credits today vs expected ${row.expectedAmount}.`;

    const existing = await prisma.usageAnomaly.findFirst({
      where: {
        workspaceId: params.workspaceId,
        feature: row.feature,
        windowStart,
        status: {
          in: ["OPEN", "ACKNOWLEDGED"]
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (existing) {
      const updated = await prisma.usageAnomaly.update({
        where: { id: existing.id },
        data: {
          severity,
          actualAmount: row.actualAmount,
          expectedAmount: row.expectedAmount,
          deviationPct: row.deviationPct,
          summary,
          metadata: {
            baselineAmount: row.baselineAmount,
            currentAmount: row.currentAmount
          }
        }
      });
      detected.push(updated);
      continue;
    }

    const created = await prisma.usageAnomaly.create({
      data: {
        workspaceId: params.workspaceId,
        feature: row.feature,
        windowStart,
        windowEnd,
        severity,
        status: "OPEN",
        actualAmount: row.actualAmount,
        expectedAmount: row.expectedAmount,
        deviationPct: row.deviationPct,
        summary,
        metadata: {
          baselineAmount: row.baselineAmount,
          currentAmount: row.currentAmount
        }
      }
    });
    detected.push(created);
  }

  return {
    windowStart,
    windowEnd,
    detected
  };
}

export async function listWorkspaceUsageAnomalies(params: {
  workspaceId: string;
  status?: UsageAnomalyStatus;
  severity?: UsageAnomalySeverity;
  take?: number;
}) {
  return prisma.usageAnomaly.findMany({
    where: {
      workspaceId: params.workspaceId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.severity ? { severity: params.severity } : {})
    },
    orderBy: {
      createdAt: "desc"
    },
    take: Math.max(1, Math.min(200, params.take ?? 50))
  });
}
