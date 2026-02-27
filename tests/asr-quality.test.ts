import { describe, expect, it } from "vitest";
import type { ProviderAdapter } from "@/lib/providers/types";
import { runAsrQualityPipeline } from "@/lib/ai/asr-quality";

function provider(name: string, words: Array<{ startMs: number; endMs: number; text: string; confidence: number }>): ProviderAdapter {
  return {
    name,
    capability: "asr",
    configured: true,
    isMock: true,
    supportsOperations: ["TRANSCRIBE"],
    run: async () => ({
      providerName: name,
      model: `${name}-model`,
      output: {
        words
      },
      usage: {
        durationMs: 120
      }
    })
  };
}

describe("asr quality pipeline", () => {
  it("uses fallback decode when primary confidence is below threshold", async () => {
    const primary = provider("deepgram", [
      { startMs: 0, endMs: 300, text: "hook", confidence: 0.6 },
      { startMs: 300, endMs: 700, text: "forge", confidence: 0.61 },
      { startMs: 700, endMs: 1100, text: "captions", confidence: 0.62 }
    ]);

    const fallback = provider("whisper-fallback", [
      { startMs: 0, endMs: 320, text: "hook", confidence: 0.92 },
      { startMs: 320, endMs: 740, text: "forge", confidence: 0.93 },
      { startMs: 740, endMs: 1200, text: "captions", confidence: 0.94 }
    ]);

    const result = await runAsrQualityPipeline({
      language: "en",
      durationMs: 1800,
      diarization: false,
      punctuationStyle: "auto",
      confidenceThreshold: 0.86,
      reDecodeEnabled: true,
      maxWordsPerSegment: 7,
      maxCharsPerLine: 24,
      maxLinesPerSegment: 2,
      primaryProvider: primary,
      fallbackProvider: fallback
    });

    expect(result.usedFallback).toBe(true);
    expect(result.averageConfidence).toBeGreaterThanOrEqual(0.9);
    expect(result.decodeAttempts.length).toBe(2);
    expect(result.decodeAttempts[1]?.accepted).toBe(true);
  });

  it("does not fallback when confidence already passes threshold", async () => {
    const primary = provider("deepgram", [
      { startMs: 0, endMs: 300, text: "hook", confidence: 0.93 },
      { startMs: 300, endMs: 700, text: "forge", confidence: 0.94 },
      { startMs: 700, endMs: 1100, text: "captions", confidence: 0.95 }
    ]);

    const fallback = provider("whisper-fallback", [
      { startMs: 0, endMs: 280, text: "fallback", confidence: 0.7 }
    ]);

    const result = await runAsrQualityPipeline({
      language: "en",
      durationMs: 1600,
      diarization: false,
      punctuationStyle: "auto",
      confidenceThreshold: 0.86,
      reDecodeEnabled: true,
      maxWordsPerSegment: 7,
      maxCharsPerLine: 24,
      maxLinesPerSegment: 2,
      primaryProvider: primary,
      fallbackProvider: fallback
    });

    expect(result.usedFallback).toBe(false);
    expect(result.decodeAttempts.length).toBe(1);
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it("applies style-safe line constraints on caption segments", async () => {
    const primary = provider("deepgram", [
      { startMs: 0, endMs: 200, text: "this", confidence: 0.93 },
      { startMs: 200, endMs: 400, text: "caption", confidence: 0.93 },
      { startMs: 400, endMs: 600, text: "must", confidence: 0.93 },
      { startMs: 600, endMs: 800, text: "wrap", confidence: 0.93 },
      { startMs: 800, endMs: 1000, text: "nicely", confidence: 0.93 },
      { startMs: 1000, endMs: 1200, text: "for", confidence: 0.93 },
      { startMs: 1200, endMs: 1400, text: "mobile", confidence: 0.93 }
    ]);

    const result = await runAsrQualityPipeline({
      language: "en",
      durationMs: 2000,
      diarization: false,
      punctuationStyle: "minimal",
      confidenceThreshold: 0.86,
      reDecodeEnabled: false,
      maxWordsPerSegment: 7,
      maxCharsPerLine: 14,
      maxLinesPerSegment: 2,
      primaryProvider: primary,
      fallbackProvider: null
    });

    expect(result.segments.length).toBeGreaterThan(0);

    for (const segment of result.segments) {
      const lines = segment.text.split("\n");
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(14);
      }
    }
  });
});
