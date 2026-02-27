import { z } from "zod";
import type { ProviderCapability, ProviderPayloadByCapability } from "@/lib/providers/types";

const AsrPayloadSchema = z.object({
  audioUrl: z.string().url().optional(),
  audioBase64: z.string().min(16).optional(),
  language: z.string().trim().min(2).max(16).optional(),
  diarization: z.boolean().optional(),
  punctuationStyle: z.enum(["auto", "minimal", "full"]).optional(),
  durationMs: z.number().int().min(100).max(7200000).optional(),
  decodeAttempt: z.number().int().min(1).max(5).optional()
}).catchall(z.unknown());

const TranslationPayloadSchema = z.object({
  text: z.string().trim().min(1).max(120000).optional(),
  sourceLanguage: z.string().trim().min(2).max(16).optional(),
  targetLanguage: z.string().trim().min(2).max(16).optional(),
  glossary: z.record(z.string(), z.string()).optional(),
  tone: z.string().trim().min(1).max(80).optional()
}).catchall(z.unknown());

const TtsPayloadSchema = z.object({
  text: z.string().trim().min(1).max(120000).optional(),
  voiceId: z.string().trim().min(1).max(120).optional(),
  language: z.string().trim().min(2).max(16).optional(),
  speed: z.number().min(0.5).max(2.0).optional()
}).catchall(z.unknown());

const VoiceClonePayloadSchema = z.object({
  voiceName: z.string().trim().min(1).max(120).optional(),
  sampleUrl: z.string().url().optional(),
  consentId: z.string().trim().min(1).max(120).optional()
}).catchall(z.unknown());

const LipSyncPayloadSchema = z.object({
  videoUrl: z.string().url().optional(),
  audioUrl: z.string().url().optional(),
  language: z.string().trim().min(2).max(16).optional()
}).catchall(z.unknown());

const GenerativeMediaPayloadSchema = z.object({
  prompt: z.string().trim().min(1).max(2000).optional(),
  script: z.string().trim().min(1).max(20000).optional(),
  seed: z.number().int().min(0).optional(),
  durationSec: z.number().min(1).max(900).optional(),
  aspectRatio: z.string().trim().min(3).max(16).optional()
}).catchall(z.unknown());

const MusicSfxPayloadSchema = z.object({
  prompt: z.string().trim().min(1).max(2000).optional(),
  durationSec: z.number().min(1).max(600).optional(),
  bpm: z.number().int().min(40).max(240).optional(),
  genre: z.string().trim().min(1).max(60).optional()
}).catchall(z.unknown());

const CapabilitySchemaMap = {
  asr: AsrPayloadSchema,
  translation: TranslationPayloadSchema,
  tts: TtsPayloadSchema,
  voice_clone: VoiceClonePayloadSchema,
  lip_sync: LipSyncPayloadSchema,
  generative_media: GenerativeMediaPayloadSchema,
  music_sfx: MusicSfxPayloadSchema
} as const;

export function validateProviderPayload<C extends ProviderCapability>(
  capability: C,
  payload: unknown
): ProviderPayloadByCapability[C] {
  return CapabilitySchemaMap[capability].parse(payload) as ProviderPayloadByCapability[C];
}

