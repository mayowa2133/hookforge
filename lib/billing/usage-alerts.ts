type LedgerSlice = {
  amount: number;
  feature: string;
  createdAt: Date;
};

type AnomalySlice = {
  id: string;
  feature: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  summary: string;
  createdAt: Date;
};

export type UsageAlert = {
  id: string;
  severity: "INFO" | "WARN" | "HIGH";
  kind: "LOW_CREDITS" | "HIGH_BURN" | "NO_ACTIVE_PLAN" | "ANOMALY_SPIKE";
  title: string;
  detail: string;
};

export function buildUsageAlerts(params: {
  balance: number;
  monthlyCredits: number | null;
  recentEntries: LedgerSlice[];
  anomalies?: AnomalySlice[];
}) {
  const alerts: UsageAlert[] = [];
  const debits = params.recentEntries.filter((entry) => entry.amount < 0).map((entry) => Math.abs(entry.amount));
  const spent7d = debits.reduce((sum, amount) => sum + amount, 0);

  const spent24h = params.recentEntries
    .filter((entry) => entry.amount < 0 && Date.now() - new Date(entry.createdAt).getTime() <= 24 * 60 * 60 * 1000)
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

  if (!params.monthlyCredits) {
    alerts.push({
      id: "no-active-plan",
      severity: "INFO",
      kind: "NO_ACTIVE_PLAN",
      title: "No active subscription tier",
      detail: "Select a plan to automate monthly credit allocation and usage thresholds."
    });
  }

  const lowCreditThreshold = params.monthlyCredits ? Math.max(150, Math.floor(params.monthlyCredits * 0.2)) : 200;
  if (params.balance <= lowCreditThreshold) {
    alerts.push({
      id: "low-credits",
      severity: params.balance <= Math.floor(lowCreditThreshold * 0.5) ? "HIGH" : "WARN",
      kind: "LOW_CREDITS",
      title: "Credits running low",
      detail: `Balance is ${params.balance} credits. Buy a credit pack or downgrade heavy workflows.`
    });
  }

  const burnThreshold = params.monthlyCredits ? Math.max(200, Math.floor(params.monthlyCredits * 0.35)) : 450;
  if (spent24h >= burnThreshold || spent7d >= burnThreshold * 2) {
    alerts.push({
      id: "high-burn",
      severity: spent24h >= burnThreshold ? "HIGH" : "WARN",
      kind: "HIGH_BURN",
      title: "Usage velocity is high",
      detail: `Spent ${spent24h} credits in 24h and ${spent7d} in 7d. Consider plan upgrade.`
    });
  }

  for (const anomaly of params.anomalies ?? []) {
    alerts.push({
      id: `anomaly-${anomaly.id}`,
      severity: anomaly.severity === "CRITICAL" || anomaly.severity === "HIGH" ? "HIGH" : "WARN",
      kind: "ANOMALY_SPIKE",
      title: `Anomalous usage detected (${anomaly.feature})`,
      detail: anomaly.summary
    });
  }

  return {
    alerts,
    metrics: {
      spent24h,
      spent7d
    }
  };
}
