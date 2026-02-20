import type { ProviderAdapter } from "@/lib/providers/types";
import { sanitizeOverlayText } from "@/lib/sanitize";

export type AsrWord = {
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string;
  confidence: number;
};

export type AsrSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

export type AsrDecodeAttempt = {
  providerName: string;
  model?: string;
  averageConfidence: number;
  wordCount: number;
  accepted: boolean;
  reason?: string;
};

export type AsrPipelineResult = {
  words: AsrWord[];
  segments: AsrSegment[];
  averageConfidence: number;
  usedFallback: boolean;
  decodeAttempts: AsrDecodeAttempt[];
  styleSafety: {
    maxCharsPerLine: number;
    maxLinesPerSegment: number;
    maxWordsPerSegment: number;
    correctionsApplied: number;
  };
};

export type AsrPipelineParams = {
  language: string;
  durationMs: number;
  diarization: boolean;
  punctuationStyle: "auto" | "minimal" | "full";
  confidenceThreshold: number;
  reDecodeEnabled: boolean;
  maxWordsPerSegment: number;
  maxCharsPerLine: number;
  maxLinesPerSegment: number;
  primaryProvider: ProviderAdapter;
  fallbackProvider: ProviderAdapter | null;
};

const scriptByLanguage: Record<string, string[]> = {
  en: ["hook", "forge", "helps", "creators", "ship", "short", "videos", "fast", "with", "clear", "captions"],
  es: ["hookforge", "ayuda", "a", "creadores", "a", "publicar", "videos", "cortos", "con", "subtitulos", "claros"],
  fr: ["hookforge", "aide", "les", "createurs", "a", "publier", "des", "videos", "courtes", "avec", "sous-titres"],
  de: ["hookforge", "hilft", "kreativen", "kurze", "videos", "schnell", "mit", "klaren", "untertiteln", "zu", "erstellen"],
  it: ["hookforge", "aiuta", "i", "creatori", "a", "pubblicare", "video", "brevi", "con", "sottotitoli", "chiari"],
  pt: ["hookforge", "ajuda", "criadores", "a", "publicar", "videos", "curtos", "com", "legendas", "claras"],
  ja: ["hookforge", "creators", "short", "video", "captions", "fast", "workflow"],
  ko: ["hookforge", "creators", "short", "video", "captions", "fast", "workflow"],
  hi: ["hookforge", "creator", "short", "video", "captions", "fast", "workflow"],
  ar: ["hookforge", "creators", "short", "video", "captions", "fast", "workflow"]
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLanguage(language: string) {
  return language.trim().toLowerCase();
}

function normalizeConfidenceThreshold(value: number) {
  if (!Number.isFinite(value)) {
    return 0.86;
  }
  return clamp(value, 0.55, 0.99);
}

function normalizeSegmentWordLimit(value: number) {
  if (!Number.isFinite(value)) {
    return 7;
  }
  return Math.trunc(clamp(value, 3, 12));
}

function normalizeCharsPerLine(value: number) {
  if (!Number.isFinite(value)) {
    return 24;
  }
  return Math.trunc(clamp(value, 14, 42));
}

function normalizeMaxLines(value: number) {
  if (!Number.isFinite(value)) {
    return 2;
  }
  return Math.trunc(clamp(value, 1, 3));
}

function confidenceBaseForProvider(providerName: string) {
  const name = providerName.toLowerCase();
  if (name.includes("deepgram")) {
    return 0.93;
  }
  if (name.includes("whisper")) {
    return 0.89;
  }
  if (name.includes("fallback")) {
    return 0.87;
  }
  return 0.9;
}

function maybeApplyPunctuation(text: string, index: number, punctuationStyle: "auto" | "minimal" | "full") {
  if (punctuationStyle === "minimal") {
    return text;
  }

  if ((index + 1) % 8 === 0) {
    if (punctuationStyle === "full") {
      return `${text}.`;
    }
    return `${text},`;
  }

  return text;
}

function safeWord(text: string) {
  return sanitizeOverlayText(text, "word");
}

function coerceWord(raw: unknown, fallbackStart: number, fallbackEnd: number, fallbackConfidence: number): AsrWord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const startMs = Number(candidate.startMs);
  const endMs = Number(candidate.endMs);
  const textRaw = typeof candidate.text === "string" ? candidate.text : "";
  const text = safeWord(textRaw);
  if (!text) {
    return null;
  }

  return {
    startMs: Number.isFinite(startMs) ? Math.max(0, Math.floor(startMs)) : fallbackStart,
    endMs: Number.isFinite(endMs) ? Math.max(0, Math.floor(endMs)) : fallbackEnd,
    text,
    speakerLabel: typeof candidate.speakerLabel === "string" ? candidate.speakerLabel : undefined,
    confidence: Number.isFinite(Number(candidate.confidence))
      ? clamp(Number(candidate.confidence), 0, 1)
      : fallbackConfidence
  };
}

function synthesizeWords(params: {
  providerName: string;
  model?: string;
  language: string;
  durationMs: number;
  diarization: boolean;
  punctuationStyle: "auto" | "minimal" | "full";
  rawOutput: Record<string, unknown>;
}) {
  const fromProvider = Array.isArray(params.rawOutput.words)
    ? (params.rawOutput.words as unknown[])
    : [];

  const wordsFromProvider: AsrWord[] = [];
  if (fromProvider.length > 0) {
    for (const raw of fromProvider) {
      const parsed = coerceWord(raw, 0, 200, 0.9);
      if (parsed) {
        wordsFromProvider.push(parsed);
      }
    }
  }

  if (wordsFromProvider.length > 0) {
    return wordsFromProvider;
  }

  const language = normalizeLanguage(params.language);
  const baseWords = scriptByLanguage[language] ?? scriptByLanguage.en;
  const wordCount = Math.max(8, Math.min(90, Math.floor(params.durationMs / 330)));
  const slotMs = Math.max(95, Math.floor(params.durationMs / wordCount));

  const confidenceBase = confidenceBaseForProvider(params.providerName);
  const words: AsrWord[] = [];
  let cursor = 0;

  for (let index = 0; index < wordCount; index += 1) {
    const token = baseWords[index % baseWords.length];
    const startMs = cursor;
    const endMs = Math.min(params.durationMs, cursor + slotMs);
    const text = maybeApplyPunctuation(token, index, params.punctuationStyle);

    words.push({
      startMs,
      endMs: Math.max(startMs + 85, endMs),
      text: safeWord(text),
      speakerLabel: params.diarization ? (index % 2 === 0 ? "Speaker 1" : "Speaker 2") : undefined,
      confidence: clamp(confidenceBase - (index % 5) * 0.01, 0.62, 0.99)
    });

    cursor = endMs;
  }

  return words;
}

function forceAlignWords(inputWords: AsrWord[], durationMs: number) {
  if (inputWords.length === 0) {
    return [] as AsrWord[];
  }

  const sorted = [...inputWords].sort((a, b) => a.startMs - b.startMs);
  const aligned: AsrWord[] = [];
  let cursor = 0;

  for (const word of sorted) {
    const startMs = clamp(Math.max(cursor, word.startMs), 0, durationMs - 80);
    const minEnd = startMs + 80;
    const rawEnd = Math.max(minEnd, word.endMs);
    const endMs = clamp(rawEnd, minEnd, durationMs);

    aligned.push({
      ...word,
      startMs,
      endMs
    });

    cursor = endMs;
    if (cursor >= durationMs) {
      break;
    }
  }

  return aligned;
}

function averageConfidence(words: AsrWord[]) {
  if (words.length === 0) {
    return 0;
  }
  const total = words.reduce((sum, word) => sum + clamp(word.confidence, 0, 1), 0);
  return total / words.length;
}

function buildLineWrappedText(words: string[], maxCharsPerLine: number, maxLines: number) {
  const lines: string[] = [];
  let current = "";

  const pushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    lines.push(trimmed.slice(0, maxCharsPerLine));
  };

  const splitWord = (word: string) => {
    const chunks: string[] = [];
    let cursor = word;
    while (cursor.length > maxCharsPerLine) {
      chunks.push(cursor.slice(0, maxCharsPerLine));
      cursor = cursor.slice(maxCharsPerLine);
    }
    if (cursor) {
      chunks.push(cursor);
    }
    return chunks;
  };

  for (const word of words) {
    if (!word) {
      continue;
    }

    if (word.length > maxCharsPerLine) {
      if (current) {
        pushLine(current);
        current = "";
      }
      for (const chunk of splitWord(word)) {
        if (lines.length >= maxLines) {
          break;
        }
        pushLine(chunk);
      }
      if (lines.length >= maxLines) {
        break;
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    if (current) {
      pushLine(current);
      current = word;
    } else {
      pushLine(word);
      current = "";
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  const trimmed = lines
    .slice(0, maxLines)
    .map((line) => line.trim().slice(0, maxCharsPerLine))
    .filter(Boolean);
  return trimmed.join("\n");
}

function segmentWords(params: {
  words: AsrWord[];
  punctuationStyle: "auto" | "minimal" | "full";
  maxWordsPerSegment: number;
  maxCharsPerLine: number;
  maxLinesPerSegment: number;
}) {
  const maxSegmentMs = 2200;
  const segments: AsrSegment[] = [];
  let correctionsApplied = 0;

  let bucket: AsrWord[] = [];
  const flush = () => {
    if (bucket.length === 0) {
      return;
    }

    const rawWords = bucket.map((word) => word.text);
    let text = buildLineWrappedText(rawWords, params.maxCharsPerLine, params.maxLinesPerSegment);

    if (!text) {
      const fallback = rawWords.join(" ").slice(0, params.maxCharsPerLine * params.maxLinesPerSegment);
      text = fallback;
      correctionsApplied += 1;
    }

    if (params.punctuationStyle === "full" && !/[.!?]$/.test(text)) {
      text = `${text}.`;
    }
    const sanitizedLines = text
      .split("\n")
      .map((line) => sanitizeOverlayText(line, "").slice(0, params.maxCharsPerLine))
      .filter(Boolean)
      .slice(0, params.maxLinesPerSegment);
    text = sanitizedLines.join("\n");

    segments.push({
      startMs: bucket[0].startMs,
      endMs: bucket[bucket.length - 1].endMs,
      text
    });

    bucket = [];
  };

  for (const word of params.words) {
    if (bucket.length === 0) {
      bucket.push(word);
      continue;
    }

    const nextBucket = [...bucket, word];
    const duration = nextBucket[nextBucket.length - 1].endMs - nextBucket[0].startMs;
    const joined = nextBucket.map((entry) => entry.text).join(" ");

    const exceedsWordLimit = nextBucket.length > params.maxWordsPerSegment;
    const exceedsDuration = duration > maxSegmentMs;
    const exceedsChars = joined.length > params.maxCharsPerLine * params.maxLinesPerSegment;

    if (exceedsWordLimit || exceedsDuration || exceedsChars) {
      flush();
      bucket.push(word);
      continue;
    }

    bucket = nextBucket;

    if (/[.!?]$/.test(word.text) && bucket.length >= 2) {
      flush();
    }
  }

  flush();

  return {
    segments,
    correctionsApplied
  };
}

async function decodeWithProvider(params: {
  provider: ProviderAdapter;
  language: string;
  durationMs: number;
  diarization: boolean;
  punctuationStyle: "auto" | "minimal" | "full";
  attemptIndex: number;
}) {
  const response = await params.provider.run({
    operation: "TRANSCRIBE",
    payload: {
      language: params.language,
      durationMs: params.durationMs,
      diarization: params.diarization,
      punctuationStyle: params.punctuationStyle,
      decodeAttempt: params.attemptIndex + 1
    }
  });

  const words = synthesizeWords({
    providerName: params.provider.name,
    model: response.model,
    language: params.language,
    durationMs: params.durationMs,
    diarization: params.diarization,
    punctuationStyle: params.punctuationStyle,
    rawOutput: response.output
  });

  const alignedWords = forceAlignWords(words, params.durationMs);
  const avgConfidence = averageConfidence(alignedWords);

  return {
    response,
    words: alignedWords,
    averageConfidence: avgConfidence
  };
}

export async function runAsrQualityPipeline(params: AsrPipelineParams): Promise<AsrPipelineResult> {
  const confidenceThreshold = normalizeConfidenceThreshold(params.confidenceThreshold);
  const maxWordsPerSegment = normalizeSegmentWordLimit(params.maxWordsPerSegment);
  const maxCharsPerLine = normalizeCharsPerLine(params.maxCharsPerLine);
  const maxLinesPerSegment = normalizeMaxLines(params.maxLinesPerSegment);

  const primary = await decodeWithProvider({
    provider: params.primaryProvider,
    language: params.language,
    durationMs: params.durationMs,
    diarization: params.diarization,
    punctuationStyle: params.punctuationStyle,
    attemptIndex: 0
  });

  const attempts: AsrDecodeAttempt[] = [
    {
      providerName: primary.response.providerName,
      model: primary.response.model,
      averageConfidence: primary.averageConfidence,
      wordCount: primary.words.length,
      accepted: true,
      reason: "primary"
    }
  ];

  let chosenWords = primary.words;
  let chosenConfidence = primary.averageConfidence;
  let usedFallback = false;

  if (
    params.reDecodeEnabled &&
    params.fallbackProvider &&
    params.fallbackProvider.name !== params.primaryProvider.name &&
    primary.averageConfidence < confidenceThreshold
  ) {
    const fallback = await decodeWithProvider({
      provider: params.fallbackProvider,
      language: params.language,
      durationMs: params.durationMs,
      diarization: params.diarization,
      punctuationStyle: params.punctuationStyle,
      attemptIndex: 1
    });

    const fallbackAccepted =
      fallback.averageConfidence >= confidenceThreshold ||
      fallback.averageConfidence > primary.averageConfidence + 0.02;

    attempts.push({
      providerName: fallback.response.providerName,
      model: fallback.response.model,
      averageConfidence: fallback.averageConfidence,
      wordCount: fallback.words.length,
      accepted: fallbackAccepted,
      reason: fallbackAccepted ? "fallback_selected" : "fallback_rejected"
    });

    if (fallbackAccepted) {
      chosenWords = fallback.words;
      chosenConfidence = fallback.averageConfidence;
      usedFallback = true;
      attempts[0] = {
        ...attempts[0],
        accepted: false,
        reason: "replaced_by_fallback"
      };
    }
  }

  const segmented = segmentWords({
    words: chosenWords,
    punctuationStyle: params.punctuationStyle,
    maxWordsPerSegment,
    maxCharsPerLine,
    maxLinesPerSegment
  });

  return {
    words: chosenWords,
    segments: segmented.segments,
    averageConfidence: chosenConfidence,
    usedFallback,
    decodeAttempts: attempts,
    styleSafety: {
      maxCharsPerLine,
      maxLinesPerSegment,
      maxWordsPerSegment,
      correctionsApplied: segmented.correctionsApplied
    }
  };
}
