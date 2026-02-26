import { randomUUID } from "crypto";
import { sanitizeOverlayText } from "@/lib/sanitize";
import type { TimelineOperation, TimelineState } from "@/lib/timeline-types";

const FILLER_TOKENS = new Set([
  "um",
  "uh",
  "erm",
  "ah",
  "like",
  "basically",
  "actually",
  "literally",
  "right",
  "okay"
]);

const FILLER_BIGRAMS = new Set(["you know", "kind of", "sort of", "i mean"]);

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeWord(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9']/g, "");
}

export type AudioEnhancementProfile = {
  preset: "clean_voice" | "dialogue_enhance" | "broadcast_loudness" | "custom";
  denoise: boolean;
  clarity: boolean;
  normalizeLoudness: boolean;
  targetLufs: number;
  intensity: number;
  trackVolumeScale: number;
  compressionRatio: number;
  eqPresence: number;
  denoiseStrength: number;
};

export type AudioIssue = {
  code: string;
  message: string;
  severity: "INFO" | "WARN" | "ERROR";
};

export type DetectedFillerCandidate = {
  id: string;
  segmentId: string | null;
  wordId: string | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  reason: "TOKEN" | "BIGRAM";
  wordIds: string[];
};

export function buildAudioEnhancementTimelineOperations(state: TimelineState, profile: AudioEnhancementProfile) {
  const audioTracks = state.tracks.filter((track) => track.kind === "AUDIO" && track.clips.length > 0);
  const issues: AudioIssue[] = [];
  const operations: TimelineOperation[] = [];
  if (audioTracks.length > 0) {
    for (const track of audioTracks) {
      operations.push({
        op: "set_track_audio",
        trackId: track.id,
        volume: clamp(track.volume * profile.trackVolumeScale, 0, 1.5)
      });
      for (const clip of track.clips) {
        operations.push({
          op: "upsert_effect",
          trackId: track.id,
          clipId: clip.id,
          effectType: "audio_enhance_v1",
          config: {
            preset: profile.preset,
            denoise: profile.denoise,
            clarity: profile.clarity,
            normalizeLoudness: profile.normalizeLoudness,
            targetLufs: profile.targetLufs,
            intensity: profile.intensity,
            compressionRatio: profile.compressionRatio,
            eqPresence: profile.eqPresence,
            denoiseStrength: profile.denoiseStrength,
            appliedAt: new Date().toISOString()
          }
        });
      }
    }
    return { operations, issues };
  }

  const videoClips = state.tracks
    .filter((track) => track.kind === "VIDEO")
    .flatMap((track) => track.clips);
  if (videoClips.length === 0) {
    issues.push({
      code: "NO_AUDIO_SOURCES",
      message: "No audio tracks or video clips found to derive audio enhancement from.",
      severity: "WARN"
    });
    return { operations, issues };
  }
  const derivedTrackId = randomUUID();
  operations.push({
    op: "create_track",
    trackId: derivedTrackId,
    kind: "AUDIO",
    name: "Derived Audio Track"
  });
  for (const clip of videoClips) {
    const clipId = randomUUID();
    const durationMs = Math.max(120, clip.timelineOutMs - clip.timelineInMs);
    operations.push({
      op: "add_clip",
      clipId,
      trackId: derivedTrackId,
      assetId: clip.assetId,
      slotKey: clip.slotKey,
      label: `Audio ${clip.label ?? "clip"}`,
      timelineInMs: clip.timelineInMs,
      durationMs,
      sourceInMs: clip.sourceInMs,
      sourceOutMs: clip.sourceOutMs
    });
    operations.push({
      op: "upsert_effect",
      trackId: derivedTrackId,
      clipId,
      effectType: "audio_enhance_v1",
      config: {
        preset: profile.preset,
        denoise: profile.denoise,
        clarity: profile.clarity,
        normalizeLoudness: profile.normalizeLoudness,
        targetLufs: profile.targetLufs,
        intensity: profile.intensity,
        compressionRatio: profile.compressionRatio,
        eqPresence: profile.eqPresence,
        denoiseStrength: profile.denoiseStrength,
        derivedFromVideo: true,
        appliedAt: new Date().toISOString()
      }
    });
  }
  operations.push({
    op: "set_track_audio",
    trackId: derivedTrackId,
    volume: clamp(profile.trackVolumeScale, 0, 1.5)
  });
  issues.push({
    code: "AUDIO_TRACK_DERIVED",
    message: "Derived an audio track from video clips for enhancement.",
    severity: "INFO"
  });

  return { operations, issues };
}

export function detectFillerCandidates(params: {
  words: Array<{
    id: string;
    segmentId: string | null;
    text: string;
    startMs: number;
    endMs: number;
    confidence: number | null;
  }>;
  segments: Array<{
    id: string;
    startMs: number;
    endMs: number;
  }>;
  maxCandidates: number;
  maxConfidence: number;
}) {
  const sortedWords = [...params.words].sort((a, b) => a.startMs - b.startMs);
  const candidates: DetectedFillerCandidate[] = [];
  const seen = new Set<string>();

  const resolveSegmentId = (word: { segmentId: string | null; startMs: number; endMs: number }) => {
    if (word.segmentId) {
      return word.segmentId;
    }
    const match = params.segments.find((segment) => word.startMs >= segment.startMs && word.endMs <= segment.endMs);
    return match?.id ?? null;
  };

  for (let index = 0; index < sortedWords.length; index += 1) {
    const word = sortedWords[index];
    const normalized = normalizeWord(word.text);
    if (!normalized) {
      continue;
    }
    const nextWord = sortedWords[index + 1];
    if (nextWord) {
      const phrase = `${normalized} ${normalizeWord(nextWord.text)}`.trim();
      if (FILLER_BIGRAMS.has(phrase)) {
        const key = `${word.startMs}:${nextWord.endMs}:${phrase}`;
        if (!seen.has(key)) {
          seen.add(key);
          const confidenceValues = [word.confidence, nextWord.confidence].filter((value): value is number => typeof value === "number");
          const avgConfidence = confidenceValues.length > 0
            ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
            : null;
          if (avgConfidence === null || avgConfidence <= params.maxConfidence) {
            candidates.push({
              id: `filler_${word.id}_${nextWord.id}`,
              segmentId: resolveSegmentId(word),
              wordId: word.id,
              startMs: word.startMs,
              endMs: nextWord.endMs,
              text: sanitizeOverlayText(`${word.text} ${nextWord.text}`, "filler"),
              confidence: avgConfidence,
              reason: "BIGRAM",
              wordIds: [word.id, nextWord.id]
            });
          }
        }
      }
    }

    if (!FILLER_TOKENS.has(normalized)) {
      continue;
    }
    const key = `${word.startMs}:${word.endMs}:${normalized}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (typeof word.confidence === "number" && word.confidence > params.maxConfidence) {
      continue;
    }
    candidates.push({
      id: `filler_${word.id}`,
      segmentId: resolveSegmentId(word),
      wordId: word.id,
      startMs: word.startMs,
      endMs: word.endMs,
      text: sanitizeOverlayText(word.text, "filler"),
      confidence: typeof word.confidence === "number" ? word.confidence : null,
      reason: "TOKEN",
      wordIds: [word.id]
    });
  }

  return candidates
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, params.maxCandidates);
}
