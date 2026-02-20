import { qualityCapabilities, type QualityCapability, type QualityCheck, type QualityGateResult, type QualityMetricSet } from "./types";

type CheckRule = {
  metric: keyof QualityMetricSet;
  name: string;
  comparator: "lte" | "gte" | "eq";
  target: number;
  unit: string;
};

const genericRules: CheckRule[] = [
  {
    metric: "successRate",
    name: "Success rate",
    comparator: "gte",
    target: 97.5,
    unit: "%"
  },
  {
    metric: "latencyP95Ms",
    name: "Latency p95",
    comparator: "lte",
    target: 4000,
    unit: "ms"
  }
];

const rulesByCapability: Record<QualityCapability, CheckRule[]> = {
  asr: [
    { metric: "werEnglish", name: "English WER", comparator: "lte", target: 8, unit: "%" },
    { metric: "werTop10", name: "Top-10 WER", comparator: "lte", target: 12, unit: "%" },
    { metric: "timingMedianMs", name: "Caption timing median", comparator: "lte", target: 80, unit: "ms" },
    { metric: "timingP95Ms", name: "Caption timing p95", comparator: "lte", target: 180, unit: "ms" },
    ...genericRules
  ],
  captions: [
    { metric: "timingMedianMs", name: "Caption timing median", comparator: "lte", target: 80, unit: "ms" },
    { metric: "timingP95Ms", name: "Caption timing p95", comparator: "lte", target: 180, unit: "ms" },
    ...genericRules
  ],
  translation: [
    { metric: "apiSuccessRate", name: "Translation API success", comparator: "gte", target: 98.5, unit: "%" },
    ...genericRules
  ],
  dubbing: [
    { metric: "dubbingMos", name: "Dubbing MOS", comparator: "gte", target: 4.2, unit: "/5" },
    { metric: "apiSuccessRate", name: "Dubbing API success", comparator: "gte", target: 98.5, unit: "%" },
    ...genericRules
  ],
  lipsync: [
    { metric: "lipSyncMedianMs", name: "Lip-sync drift median", comparator: "lte", target: 60, unit: "ms" },
    { metric: "lipSyncP95Ms", name: "Lip-sync drift p95", comparator: "lte", target: 120, unit: "ms" },
    ...genericRules
  ],
  ai_edit: [
    { metric: "validPlanRate", name: "Valid plan success", comparator: "gte", target: 98, unit: "%" },
    ...genericRules
  ],
  chat_edit: [
    { metric: "validPlanRate", name: "Valid plan success", comparator: "gte", target: 98, unit: "%" },
    { metric: "undoCorrectnessRate", name: "Undo correctness", comparator: "gte", target: 99.5, unit: "%" },
    ...genericRules
  ],
  creator: [
    { metric: "ratingScore", name: "Creator quality rating", comparator: "gte", target: 4.2, unit: "/5" },
    ...genericRules
  ],
  ads: [
    { metric: "ratingScore", name: "Ads quality rating", comparator: "gte", target: 4.2, unit: "/5" },
    { metric: "candidateUpliftPct", name: "Ranked candidate uplift", comparator: "gte", target: 0, unit: "%" },
    ...genericRules
  ],
  shorts: [
    { metric: "ratingScore", name: "Shorts quality rating", comparator: "gte", target: 4.2, unit: "/5" },
    { metric: "candidateUpliftPct", name: "Ranked candidate uplift", comparator: "gte", target: 0, unit: "%" },
    ...genericRules
  ],
  public_translate: [
    { metric: "apiSuccessRate", name: "Public API success", comparator: "gte", target: 98.5, unit: "%" },
    ...genericRules
  ],
  mobile: [
    { metric: "crashFreeSessions", name: "Crash-free sessions", comparator: "gte", target: 99.5, unit: "%" },
    { metric: "workflowCompletionGapPct", name: "Workflow completion gap", comparator: "lte", target: 10, unit: "%" }
  ],
  billing: [
    { metric: "ledgerReconciliationRate", name: "Ledger reconciliation", comparator: "eq", target: 100, unit: "%" },
    { metric: "criticalBillingDefects", name: "Critical billing defects", comparator: "eq", target: 0, unit: "count" }
  ],
  general: [...genericRules]
};

function normalizeCapability(value: string): QualityCapability {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((qualityCapabilities as readonly string[]).includes(normalized)) {
    return normalized as QualityCapability;
  }

  if (normalized.includes("lip")) {
    return "lipsync";
  }
  if (normalized.includes("dub")) {
    return "dubbing";
  }
  if (normalized.includes("caption") || normalized.includes("asr")) {
    return "asr";
  }
  if (normalized.includes("translate")) {
    return "translation";
  }
  if (normalized.includes("chat")) {
    return "chat_edit";
  }
  if (normalized.includes("edit")) {
    return "ai_edit";
  }
  if (normalized.includes("mobile")) {
    return "mobile";
  }
  if (normalized.includes("bill") || normalized.includes("credit")) {
    return "billing";
  }

  return "general";
}

function compare(rule: CheckRule, current: number) {
  switch (rule.comparator) {
    case "gte":
      return current >= rule.target;
    case "lte":
      return current <= rule.target;
    case "eq":
      return current === rule.target;
    default:
      return false;
  }
}

function toCheck(rule: CheckRule, metrics: QualityMetricSet): QualityCheck {
  const raw = metrics[rule.metric];
  const current = typeof raw === "number" && Number.isFinite(raw) ? raw : Number.NaN;
  const passed = Number.isFinite(current) ? compare(rule, current) : false;

  return {
    name: rule.name,
    passed,
    current,
    target: rule.target,
    comparator: rule.comparator,
    unit: rule.unit
  };
}

export function buildDefaultMetricsForCapability(capabilityInput: string): QualityMetricSet {
  const capability = normalizeCapability(capabilityInput);

  switch (capability) {
    case "asr":
    case "captions":
      return { successRate: 98.3, latencyP95Ms: 2100, werEnglish: 7.8, werTop10: 11.6, timingMedianMs: 72, timingP95Ms: 158 };
    case "translation":
    case "public_translate":
      return { successRate: 98.9, latencyP95Ms: 1850, apiSuccessRate: 99.1 };
    case "dubbing":
      return { successRate: 98.2, latencyP95Ms: 3200, dubbingMos: 4.24, apiSuccessRate: 98.7 };
    case "lipsync":
      return { successRate: 97.9, latencyP95Ms: 3400, lipSyncMedianMs: 57, lipSyncP95Ms: 114 };
    case "ai_edit":
      return { successRate: 98.1, latencyP95Ms: 2600, validPlanRate: 98.3 };
    case "chat_edit":
      return { successRate: 98.4, latencyP95Ms: 2200, validPlanRate: 98.8, undoCorrectnessRate: 99.6 };
    case "creator":
    case "ads":
    case "shorts":
      return { successRate: 97.8, latencyP95Ms: 3600, ratingScore: 4.23, candidateUpliftPct: 4.8 };
    case "mobile":
      return { crashFreeSessions: 99.62, workflowCompletionGapPct: 8.6 };
    case "billing":
      return { ledgerReconciliationRate: 100, criticalBillingDefects: 0 };
    default:
      return { successRate: 98.0, latencyP95Ms: 2400 };
  }
}

export function evaluateQualityGate(params: {
  capability: string;
  metrics: QualityMetricSet;
}): QualityGateResult {
  const capability = normalizeCapability(params.capability);
  const checks = rulesByCapability[capability].map((rule) => toCheck(rule, params.metrics));

  const reasons = checks
    .filter((check) => !check.passed)
    .map((check) => {
      if (!Number.isFinite(check.current)) {
        return `${check.name} missing metric`;
      }
      return `${check.name} failed (${check.current}${check.unit} vs target ${check.comparator} ${check.target}${check.unit})`;
    });

  return {
    capability,
    passed: reasons.length === 0,
    checks,
    reasons
  };
}
