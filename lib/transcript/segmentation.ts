import { sanitizeOverlayText } from "@/lib/sanitize";

export type TranscriptWordLike = {
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string | null;
  confidence?: number | null;
};

export type TranscriptSegmentLike = {
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string | null;
  confidenceAvg?: number | null;
};

export type SegmentFromWordsOptions = {
  maxWordsPerSegment?: number;
  maxCharsPerLine?: number;
  maxLinesPerSegment?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function maxCharsForSegment(options: SegmentFromWordsOptions) {
  const charsPerLine = clamp(Math.floor(options.maxCharsPerLine ?? 24), 14, 42);
  const lines = clamp(Math.floor(options.maxLinesPerSegment ?? 2), 1, 3);
  return charsPerLine * lines;
}

function maxWordsForSegment(options: SegmentFromWordsOptions) {
  return clamp(Math.floor(options.maxWordsPerSegment ?? 7), 3, 14);
}

function normalizeWord(text: string) {
  return sanitizeOverlayText(text, "word");
}

function toSafeWordList(words: TranscriptWordLike[]) {
  return [...words]
    .map((word) => ({
      ...word,
      startMs: Math.max(0, Math.floor(word.startMs)),
      endMs: Math.max(Math.floor(word.startMs) + 80, Math.floor(word.endMs)),
      text: normalizeWord(word.text),
      confidence: typeof word.confidence === "number" ? clamp(word.confidence, 0, 1) : null
    }))
    .filter((word) => word.text.length > 0)
    .sort((a, b) => a.startMs - b.startMs);
}

export function buildTranscriptSegmentsFromWords(
  words: TranscriptWordLike[],
  options: SegmentFromWordsOptions = {}
): TranscriptSegmentLike[] {
  const safeWords = toSafeWordList(words);
  if (safeWords.length === 0) {
    return [];
  }

  const wordLimit = maxWordsForSegment(options);
  const charLimit = maxCharsForSegment(options);
  const segments: TranscriptSegmentLike[] = [];

  let cursor = 0;
  while (cursor < safeWords.length) {
    const chunk: typeof safeWords = [];
    let charCount = 0;

    for (let i = cursor; i < safeWords.length; i += 1) {
      const candidate = safeWords[i];
      const nextChars = charCount + (chunk.length > 0 ? 1 : 0) + candidate.text.length;
      if (chunk.length >= wordLimit || nextChars > charLimit) {
        break;
      }
      chunk.push(candidate);
      charCount = nextChars;
    }

    if (chunk.length === 0) {
      chunk.push(safeWords[cursor]);
    }

    const confidenceValues = chunk
      .map((word) => word.confidence)
      .filter((value): value is number => typeof value === "number");
    const confidenceAvg = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : null;

    segments.push({
      startMs: chunk[0].startMs,
      endMs: chunk[chunk.length - 1].endMs,
      text: sanitizeOverlayText(chunk.map((word) => word.text).join(" "), "caption"),
      speakerLabel: chunk[0].speakerLabel ?? null,
      confidenceAvg
    });

    cursor += chunk.length;
  }

  return segments;
}

export function assignSegmentIdsToWords<T extends TranscriptWordLike>(
  words: T[],
  segments: Array<TranscriptSegmentLike & { id: string }>
) {
  return words.map((word) => {
    const containing = segments.find(
      (segment) => word.startMs >= segment.startMs && word.endMs <= segment.endMs
    );

    let matching = containing;
    if (!matching) {
      let bestOverlap = -1;
      for (const segment of segments) {
        const overlap = Math.max(0, Math.min(word.endMs, segment.endMs) - Math.max(word.startMs, segment.startMs));
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          matching = segment;
        }
      }
    }

    return {
      ...word,
      segmentId: matching?.id ?? null
    };
  });
}

export function rebuildWordsFromSegments(segments: TranscriptSegmentLike[]) {
  const words: TranscriptWordLike[] = [];

  for (const segment of segments) {
    const tokens = sanitizeOverlayText(segment.text, "caption").split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      continue;
    }
    const durationMs = Math.max(120, segment.endMs - segment.startMs);
    const slotMs = Math.max(80, Math.floor(durationMs / tokens.length));
    let cursor = segment.startMs;
    for (const token of tokens) {
      const endMs = Math.min(segment.endMs, cursor + slotMs);
      words.push({
        startMs: cursor,
        endMs: Math.max(cursor + 60, endMs),
        text: token,
        speakerLabel: segment.speakerLabel ?? null,
        confidence: segment.confidenceAvg ?? null
      });
      cursor = endMs;
    }
  }

  return words;
}
