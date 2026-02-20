export const qualityCapabilities = [
  "asr",
  "captions",
  "translation",
  "dubbing",
  "lipsync",
  "ai_edit",
  "chat_edit",
  "creator",
  "ads",
  "shorts",
  "public_translate",
  "mobile",
  "billing",
  "general"
] as const;

export type QualityCapability = (typeof qualityCapabilities)[number];

export type QualityMetricSet = {
  successRate?: number;
  latencyP95Ms?: number;
  werEnglish?: number;
  werTop10?: number;
  timingMedianMs?: number;
  timingP95Ms?: number;
  dubbingMos?: number;
  lipSyncMedianMs?: number;
  lipSyncP95Ms?: number;
  validPlanRate?: number;
  undoCorrectnessRate?: number;
  apiSuccessRate?: number;
  crashFreeSessions?: number;
  workflowCompletionGapPct?: number;
  ratingScore?: number;
  candidateUpliftPct?: number;
  ledgerReconciliationRate?: number;
  criticalBillingDefects?: number;
  costPerMinUsd?: number;
};

export type QualityCheck = {
  name: string;
  passed: boolean;
  current: number;
  target: number;
  comparator: "lte" | "gte" | "eq";
  unit: string;
};

export type QualityGateResult = {
  capability: QualityCapability;
  passed: boolean;
  checks: QualityCheck[];
  reasons: string[];
};
