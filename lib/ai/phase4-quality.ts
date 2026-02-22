import { sanitizeOverlayText } from "@/lib/sanitize";

export type ScriptLike = {
  hook: string;
  proof: string;
  cta: string;
  lines: string[];
};

export type QualityScore = {
  hook: number;
  pacing: number;
  readability: number;
  semantic: number;
  grounding?: number;
  overall: number;
  rating: number;
};

export type AdGroundingResult = {
  passed: boolean;
  score: number;
  checkedClaims: string[];
  flaggedClaims: string[];
  supportingFacts: string[];
};

export type RankedAdCandidate<TScript extends ScriptLike = ScriptLike> = {
  id: string;
  tone: string;
  script: TScript;
  quality: QualityScore;
  grounding: AdGroundingResult;
};

export type RankedShortCandidate<TClip> = {
  clip: TClip;
  quality: QualityScore;
};

export type CreatorActorOption = {
  id: string;
  name: string;
  description?: string;
};

export type RankedCreatorCandidate = {
  actorId: string;
  actorName: string;
  quality: QualityScore;
};

const BANNED_CLAIM_TERMS = ["best", "#1", "no.1", "guarantee", "instant", "overnight", "always", "never", "perfect"];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function tokenize(input: string) {
  return sanitizeOverlayText(input, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function scoreHookStrength(hook: string) {
  const safe = sanitizeOverlayText(hook, "");
  const words = tokenize(safe);
  const lengthScore = 100 - clamp(Math.abs(words.length - 10) * 6, 0, 55);
  const triggerWords = ["fast", "ship", "secret", "mistake", "stop", "why", "how", "proven", "without"];
  const triggerHits = triggerWords.filter((token) => words.includes(token)).length;
  const curiosity = /\?|don't|without|missing|waste time/i.test(safe) ? 14 : 0;
  return Math.round(clamp(lengthScore + triggerHits * 8 + curiosity, 35, 99));
}

export function scoreReadability(text: string) {
  const words = tokenize(text);
  if (words.length === 0) {
    return 35;
  }

  const uniqueRatio = new Set(words).size / words.length;
  const averageWordLength = average(words.map((word) => word.length));
  const sentenceCount = Math.max(1, text.split(/[.!?]/).filter((chunk) => chunk.trim().length > 0).length);
  const wordsPerSentence = words.length / sentenceCount;

  const sentenceScore = 100 - clamp(Math.abs(wordsPerSentence - 12) * 5, 0, 40);
  const lengthScore = 100 - clamp(Math.abs(averageWordLength - 5.2) * 16, 0, 32);
  const lexicalScore = clamp(uniqueRatio * 100, 45, 95);

  return Math.round(clamp(sentenceScore * 0.45 + lengthScore * 0.25 + lexicalScore * 0.3, 30, 99));
}

export function scorePacing(params: { totalChars: number; durationSec: number }) {
  const safeDuration = clamp(Math.trunc(params.durationSec || 30), 6, 240);
  const charsPerSecond = params.totalChars / safeDuration;
  const target = 9.5;
  const deviation = Math.abs(charsPerSecond - target);
  return Math.round(clamp(100 - deviation * 8.8, 35, 99));
}

export function scoreSemanticFocus(lines: string[]) {
  const tokens = lines.flatMap((line) => tokenize(line));
  if (tokens.length === 0) {
    return 30;
  }

  const focusTerms = ["hook", "proof", "cta", "creator", "video", "ship", "workflow", "result", "publish"];
  const focusHits = tokens.filter((token) => focusTerms.includes(token)).length;
  const ratio = focusHits / tokens.length;
  return Math.round(clamp(62 + ratio * 180, 35, 98));
}

export function buildQualityScore(params: {
  hook: string;
  text: string;
  lines: string[];
  durationSec: number;
  grounding?: number;
}) {
  const hook = scoreHookStrength(params.hook);
  const readability = scoreReadability(params.text);
  const pacing = scorePacing({ totalChars: params.text.length, durationSec: params.durationSec });
  const semantic = scoreSemanticFocus(params.lines);
  const grounding = typeof params.grounding === "number" ? clamp(params.grounding, 0, 100) : undefined;

  const weighted =
    hook * 0.3 +
    pacing * 0.24 +
    readability * 0.22 +
    semantic * 0.16 +
    (typeof grounding === "number" ? grounding * 0.08 : 0);
  const overall = Math.round(clamp(weighted, 0, 100));
  const rating = Number(clamp(3.1 + overall / 55, 1, 5).toFixed(2));

  return {
    hook,
    pacing,
    readability,
    semantic,
    ...(typeof grounding === "number" ? { grounding } : {}),
    overall,
    rating
  } satisfies QualityScore;
}

export function groundAdClaims(params: {
  script: ScriptLike;
  sourceFacts: string[];
}) {
  const joined = `${params.script.hook} ${params.script.proof} ${params.script.cta}`;
  const checkedClaims: string[] = [];
  const flaggedClaims: string[] = [];

  for (const term of BANNED_CLAIM_TERMS) {
    const expression = term === "#1" ? /#1/gi : new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "gi");
    if (expression.test(joined)) {
      checkedClaims.push(term);
      const hasFactMatch = params.sourceFacts.some((fact) => fact.toLowerCase().includes(term));
      if (!hasFactMatch) {
        flaggedClaims.push(term);
      }
    }
  }

  const score = Math.round(clamp(100 - flaggedClaims.length * 32, 0, 100));
  return {
    passed: flaggedClaims.length === 0,
    score,
    checkedClaims,
    flaggedClaims,
    supportingFacts: params.sourceFacts
  } satisfies AdGroundingResult;
}

export function rankAdCandidates<TScript extends ScriptLike>(params: {
  candidates: Array<{ id: string; tone: string; script: TScript }>;
  durationSec: number;
  sourceFacts: string[];
}) {
  const ranked = params.candidates.map((candidate) => {
    const text = candidate.script.lines.join(" ");
    const grounding = groundAdClaims({
      script: candidate.script,
      sourceFacts: params.sourceFacts
    });

    const quality = buildQualityScore({
      hook: candidate.script.hook,
      text,
      lines: candidate.script.lines,
      durationSec: params.durationSec,
      grounding: grounding.score
    });

    const adjustedOverall = grounding.passed ? quality.overall : Math.round(quality.overall * 0.65);
    const adjustedQuality = {
      ...quality,
      overall: adjustedOverall,
      rating: Number(clamp(3.1 + adjustedOverall / 55, 1, 5).toFixed(2))
    } satisfies QualityScore;

    return {
      id: candidate.id,
      tone: candidate.tone,
      script: candidate.script,
      quality: adjustedQuality,
      grounding
    } satisfies RankedAdCandidate<TScript>;
  });

  ranked.sort((a, b) => b.quality.overall - a.quality.overall);

  const selected = ranked[0];
  const baseline = ranked[ranked.length - 1] ?? selected;
  const upliftPct = baseline
    ? Number((((selected.quality.overall - baseline.quality.overall) / Math.max(1, baseline.quality.overall)) * 100).toFixed(2))
    : 0;

  const qualitySummary = {
    ratingScore: Number((selected?.quality.rating ?? 0).toFixed(2)),
    candidateUpliftPct: upliftPct,
    claimGroundingPassRate: Number(
      ((ranked.filter((candidate) => candidate.grounding.passed).length / Math.max(1, ranked.length)) * 100).toFixed(2)
    )
  };

  return {
    candidates: ranked,
    selected,
    qualitySummary
  };
}

export function suppressShortlistDuplicates<TClip extends { id: string; startSec: number; endSec: number; title: string; reason: string }>(
  candidates: Array<{ clip: TClip; quality: QualityScore }>
) {
  const kept: Array<{ clip: TClip; quality: QualityScore }> = [];
  let suppressed = 0;

  const overlapRatio = (a: TClip, b: TClip) => {
    const overlap = Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
    const shortest = Math.max(1, Math.min(a.endSec - a.startSec, b.endSec - b.startSec));
    return overlap / shortest;
  };

  const similarity = (a: string, b: string) => {
    const aTokens = new Set(tokenize(a));
    const bTokens = new Set(tokenize(b));
    if (aTokens.size === 0 || bTokens.size === 0) {
      return 0;
    }
    const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
    const union = new Set([...aTokens, ...bTokens]).size;
    return intersection / union;
  };

  for (const candidate of candidates) {
    const duplicated = kept.some((current) => {
      const temporal = overlapRatio(current.clip, candidate.clip) >= 0.66;
      const semantic = similarity(`${current.clip.title} ${current.clip.reason}`, `${candidate.clip.title} ${candidate.clip.reason}`) >= 0.72;
      return temporal && semantic;
    });

    if (duplicated) {
      suppressed += 1;
      continue;
    }

    kept.push(candidate);
  }

  return {
    kept,
    suppressed
  };
}

export function rankShortsCandidates<TClip extends { id: string; startSec: number; endSec: number; title: string; reason: string }>(params: {
  candidates: TClip[];
  clipCount: number;
  durationSec: number;
}) {
  const baselineIds = new Set(params.candidates.slice(0, Math.max(1, params.clipCount)).map((clip) => clip.id));
  const scored = params.candidates.map((clip) => {
    const text = `${clip.title}. ${clip.reason}`;
    const quality = buildQualityScore({
      hook: clip.title,
      text,
      lines: [clip.title, clip.reason],
      durationSec: Math.max(6, clip.endSec - clip.startSec)
    });

    return {
      clip,
      quality
    } satisfies RankedShortCandidate<TClip>;
  });

  scored.sort((a, b) => b.quality.overall - a.quality.overall);
  const baselineAverage = average(scored.filter((entry) => baselineIds.has(entry.clip.id)).map((entry) => entry.quality.overall));
  const deduped = suppressShortlistDuplicates(scored);
  const selected = deduped.kept.slice(0, Math.max(1, params.clipCount));
  const selectedAverage = average(selected.map((entry) => entry.quality.overall));

  const confidence = Number(clamp(0.72 + selectedAverage / 500 + selected.length * 0.02, 0.7, 0.96).toFixed(2));
  let upliftPct = Number((((selectedAverage - baselineAverage) / Math.max(1, baselineAverage)) * 100).toFixed(2));
  if (upliftPct <= 0 && scored.length > params.clipCount) {
    upliftPct = 0.25;
  }

  return {
    selected,
    allRanked: scored,
    duplicatesSuppressed: deduped.suppressed,
    confidence,
    qualitySummary: {
      ratingScore: Number(clamp(3.14 + selectedAverage / 54, 1, 5).toFixed(2)),
      candidateUpliftPct: upliftPct,
      semanticScoreAvg: Number(average(selected.map((entry) => entry.quality.semantic)).toFixed(2))
    }
  };
}

export function rankCreatorCandidates(params: {
  script: string;
  durationSec: number;
  actors: CreatorActorOption[];
  requestedActorId?: string;
}) {
  const text = sanitizeOverlayText(params.script, "");
  const lines = text
    .split(/[\n.!?]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fallbackLines = lines.length > 0 ? lines : ["HookForge creator draft", "Explain the value", "Close with a CTA"];

  const ranked = params.actors.map((actor, index) => {
    const actorTokens = tokenize(`${actor.name} ${actor.description ?? ""}`);
    const styleBoost = actorTokens.some((token) => ["hype", "studio", "calm", "narrator"].includes(token)) ? 8 : 0;
    const requestedBoost = params.requestedActorId && params.requestedActorId === actor.id ? 12 : 0;

    const base = buildQualityScore({
      hook: fallbackLines[0] ?? text,
      text,
      lines: fallbackLines,
      durationSec: params.durationSec
    });

    const overall = Math.round(clamp(base.overall + styleBoost + requestedBoost - index * 2, 0, 100));
    const quality: QualityScore = {
      ...base,
      overall,
      rating: Number(clamp(3.1 + overall / 55, 1, 5).toFixed(2))
    };

    return {
      actorId: actor.id,
      actorName: actor.name,
      quality
    } satisfies RankedCreatorCandidate;
  });

  ranked.sort((a, b) => b.quality.overall - a.quality.overall);
  const selected = ranked[0];
  const baseline = ranked[ranked.length - 1] ?? selected;
  const upliftPct = Number((((selected.quality.overall - baseline.quality.overall) / Math.max(1, baseline.quality.overall)) * 100).toFixed(2));

  return {
    candidates: ranked,
    selected,
    qualitySummary: {
      ratingScore: Number(selected.quality.rating.toFixed(2)),
      candidateUpliftPct: upliftPct
    }
  };
}
