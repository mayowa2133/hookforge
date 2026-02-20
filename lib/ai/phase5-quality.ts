export type DubbingAdaptationPlan = {
  sourceDurationSec: number;
  targetDurationSec: number;
  tempoRatio: number;
  expansionFactor: number;
  pauseDensityPerMin: number;
  prosodyStyle: "balanced" | "energetic" | "calm";
  scriptLengthBudgetChars: number;
};

export type LipSyncScore = {
  driftMedianMs: number;
  driftP95Ms: number;
  passed: boolean;
  score: number;
  regenerateRecommended: boolean;
};

const languageExpansionFactors: Record<string, number> = {
  en: 1,
  es: 1.08,
  fr: 1.07,
  de: 1.05,
  it: 1.06,
  pt: 1.08,
  ja: 0.9,
  ko: 0.93,
  hi: 1.11,
  ar: 1.1
};

const languageLipSyncPenalty: Record<string, number> = {
  en: 0,
  es: 5,
  fr: 4,
  de: 3,
  it: 5,
  pt: 6,
  ja: 7,
  ko: 8,
  hi: 9,
  ar: 10
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLanguage(language: string) {
  return language.trim().toLowerCase();
}

function expansionFactorFor(language: string) {
  const normalized = normalizeLanguage(language);
  return languageExpansionFactors[normalized] ?? 1.04;
}

function prosodyStyleForTone(tone: string) {
  const normalized = tone.trim().toLowerCase();
  if (normalized.includes("energetic") || normalized.includes("hype") || normalized.includes("bold")) {
    return "energetic" as const;
  }
  if (normalized.includes("calm") || normalized.includes("soft") || normalized.includes("gentle")) {
    return "calm" as const;
  }
  return "balanced" as const;
}

export function buildDubbingAdaptationPlan(params: {
  sourceDurationSec: number;
  sourceLanguage: string;
  targetLanguage: string;
  lipDub: boolean;
  tone: string;
  glossarySize?: number;
}) {
  const sourceDurationSec = clamp(params.sourceDurationSec || 1, 1, 60 * 60);
  const expansionFactor = expansionFactorFor(params.targetLanguage);
  const lipSyncConstraint = params.lipDub ? 0.96 : 1;
  const glossaryFactor = 1 + clamp((params.glossarySize ?? 0) / 400, 0, 0.12);

  const rawTargetDuration = sourceDurationSec * expansionFactor * lipSyncConstraint;
  const targetDurationSec = clamp(rawTargetDuration, sourceDurationSec * 0.88, sourceDurationSec * 1.24);
  const tempoRatio = clamp(sourceDurationSec / targetDurationSec, 0.84, 1.18);

  const prosodyStyle = prosodyStyleForTone(params.tone);
  const pauseDensityPerMin = Math.round(clamp(12 * (1 / tempoRatio), 8, 24));
  const scriptLengthBudgetChars = Math.round(clamp(targetDurationSec * 14 * glossaryFactor, 90, 6000));

  return {
    sourceDurationSec,
    targetDurationSec,
    tempoRatio,
    expansionFactor,
    pauseDensityPerMin,
    prosodyStyle,
    scriptLengthBudgetChars
  } satisfies DubbingAdaptationPlan;
}

export function scoreLipSyncAlignment(params: {
  targetLanguage: string;
  durationSec: number;
  attempt: number;
  adaptationPlan: DubbingAdaptationPlan;
}) {
  const normalizedLanguage = normalizeLanguage(params.targetLanguage);
  const langPenalty = languageLipSyncPenalty[normalizedLanguage] ?? 8;

  const durationPenalty = clamp(Math.round((params.durationSec - 30) / 6), -4, 12);
  const attemptBonus = clamp(params.attempt, 0, 3) * 8;
  const tempoPenalty = Math.round(Math.abs(1 - params.adaptationPlan.tempoRatio) * 80);

  const driftMedianMs = clamp(48 + langPenalty + durationPenalty + tempoPenalty - attemptBonus, 28, 170);
  const driftP95Ms = clamp(driftMedianMs + 44 + langPenalty, 72, 290);

  const passed = driftMedianMs <= 60 && driftP95Ms <= 120;
  const regenerateRecommended = !passed && params.attempt < 2;

  const score = clamp(
    1 - (driftMedianMs / 180) * 0.6 - (driftP95Ms / 320) * 0.4,
    0,
    1
  );

  return {
    driftMedianMs,
    driftP95Ms,
    passed,
    score,
    regenerateRecommended
  } satisfies LipSyncScore;
}

export function estimateDubbingMos(params: {
  adaptationPlan: DubbingAdaptationPlan;
  lipSyncScore?: LipSyncScore;
  lipDub: boolean;
}) {
  const tempoPenalty = Math.abs(1 - params.adaptationPlan.tempoRatio) * 1.2;
  const lipSyncPenalty = params.lipDub && params.lipSyncScore ? (1 - params.lipSyncScore.score) * 0.9 : 0;

  const base = params.lipDub ? 4.28 : 4.34;
  const mos = clamp(base - tempoPenalty - lipSyncPenalty, 3.2, 4.8);
  return Number(mos.toFixed(2));
}

export function summarizeDubbingQuality(artifacts: Array<{
  language: string;
  quality: {
    mosEstimate: number;
    lipSync?: {
      driftMedianMs: number;
      driftP95Ms: number;
      passed: boolean;
    };
  };
}>) {
  if (artifacts.length === 0) {
    return {
      mosAverage: null,
      lipSyncMedianMs: null,
      lipSyncP95Ms: null,
      lipSyncPassRate: null
    };
  }

  const mosAverage = Number((artifacts.reduce((sum, artifact) => sum + artifact.quality.mosEstimate, 0) / artifacts.length).toFixed(2));

  const lipSyncRows = artifacts
    .map((artifact) => artifact.quality.lipSync)
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (lipSyncRows.length === 0) {
    return {
      mosAverage,
      lipSyncMedianMs: null,
      lipSyncP95Ms: null,
      lipSyncPassRate: null
    };
  }

  const lipSyncMedianMs = Number((lipSyncRows.reduce((sum, row) => sum + row.driftMedianMs, 0) / lipSyncRows.length).toFixed(1));
  const lipSyncP95Ms = Number((lipSyncRows.reduce((sum, row) => sum + row.driftP95Ms, 0) / lipSyncRows.length).toFixed(1));
  const lipSyncPassRate = Number(((lipSyncRows.filter((row) => row.passed).length / lipSyncRows.length) * 100).toFixed(1));

  return {
    mosAverage,
    lipSyncMedianMs,
    lipSyncP95Ms,
    lipSyncPassRate
  };
}
