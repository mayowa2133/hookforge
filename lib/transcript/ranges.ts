import { sanitizeOverlayText } from "@/lib/sanitize";

type TranscriptWordLike = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
};

type TranscriptSegmentLike = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerLabel: string | null;
  confidenceAvg: number | null;
};

export type TranscriptRangeSelection = {
  startWordIndex: number;
  endWordIndex: number;
};

export type TranscriptResolvedRange = {
  startWordIndex: number;
  endWordIndex: number;
  startMs: number;
  endMs: number;
  wordCount: number;
  textPreview: string;
};

export type TranscriptSegmentRange = {
  segmentId: string;
  startWordIndex: number;
  endWordIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel: string | null;
  confidenceAvg: number | null;
};

export function resolveTranscriptRangeSelection(words: TranscriptWordLike[], selection: TranscriptRangeSelection): TranscriptResolvedRange | null {
  if (words.length === 0) {
    return null;
  }
  const start = Math.max(0, Math.min(words.length - 1, Math.floor(selection.startWordIndex)));
  const end = Math.max(start, Math.min(words.length - 1, Math.floor(selection.endWordIndex)));
  const selectedWords = words.slice(start, end + 1);
  if (selectedWords.length === 0) {
    return null;
  }
  const textPreview = sanitizeOverlayText(selectedWords.map((word) => word.text).join(" "), "caption");
  return {
    startWordIndex: start,
    endWordIndex: end,
    startMs: selectedWords[0].startMs,
    endMs: selectedWords[selectedWords.length - 1].endMs,
    wordCount: selectedWords.length,
    textPreview
  };
}

export function buildSegmentWordRanges(params: {
  segments: TranscriptSegmentLike[];
  words: TranscriptWordLike[];
}) {
  const segments = [...params.segments].sort((a, b) => a.startMs - b.startMs);
  const words = [...params.words].sort((a, b) => a.startMs - b.startMs);
  const ranges: TranscriptSegmentRange[] = [];

  let cursor = 0;
  for (const segment of segments) {
    while (cursor < words.length && words[cursor].endMs <= segment.startMs) {
      cursor += 1;
    }
    const startWordIndex = cursor;
    while (cursor < words.length && words[cursor].startMs < segment.endMs) {
      cursor += 1;
    }
    const endWordIndex = cursor - 1;

    ranges.push({
      segmentId: segment.id,
      startWordIndex: startWordIndex <= endWordIndex ? startWordIndex : -1,
      endWordIndex: startWordIndex <= endWordIndex ? endWordIndex : -1,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      speakerLabel: segment.speakerLabel,
      confidenceAvg: segment.confidenceAvg
    });
  }

  return ranges;
}
