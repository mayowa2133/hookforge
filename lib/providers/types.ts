export type ProviderCapability =
  | "asr"
  | "translation"
  | "tts"
  | "voice_clone"
  | "lip_sync"
  | "generative_media"
  | "music_sfx";

export type ProviderAsrPayload = {
  audioUrl?: string;
  audioBase64?: string;
  language?: string;
  diarization?: boolean;
  punctuationStyle?: "auto" | "minimal" | "full";
  durationMs?: number;
  decodeAttempt?: number;
  [key: string]: unknown;
};

export type ProviderTranslationPayload = {
  text?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  glossary?: Record<string, string>;
  tone?: string;
  [key: string]: unknown;
};

export type ProviderTtsPayload = {
  text?: string;
  voiceId?: string;
  language?: string;
  speed?: number;
  [key: string]: unknown;
};

export type ProviderVoiceClonePayload = {
  voiceName?: string;
  sampleUrl?: string;
  consentId?: string;
  [key: string]: unknown;
};

export type ProviderLipSyncPayload = {
  videoUrl?: string;
  audioUrl?: string;
  language?: string;
  [key: string]: unknown;
};

export type ProviderGenerativeMediaPayload = {
  prompt?: string;
  script?: string;
  seed?: number;
  durationSec?: number;
  aspectRatio?: string;
  [key: string]: unknown;
};

export type ProviderMusicSfxPayload = {
  prompt?: string;
  durationSec?: number;
  bpm?: number;
  genre?: string;
  [key: string]: unknown;
};

export type ProviderPayloadByCapability = {
  asr: ProviderAsrPayload;
  translation: ProviderTranslationPayload;
  tts: ProviderTtsPayload;
  voice_clone: ProviderVoiceClonePayload;
  lip_sync: ProviderLipSyncPayload;
  generative_media: ProviderGenerativeMediaPayload;
  music_sfx: ProviderMusicSfxPayload;
};

export type ProviderRequest<C extends ProviderCapability = ProviderCapability> = {
  operation: string;
  payload: ProviderPayloadByCapability[C];
};

export type ProviderResponse = {
  providerName: string;
  model?: string;
  output: Record<string, unknown>;
  usage?: {
    tokensIn?: number;
    tokensOut?: number;
    durationMs?: number;
    costUsd?: number;
  };
};

export type ProviderAdapter<C extends ProviderCapability = ProviderCapability> = {
  name: string;
  capability: C;
  configured: boolean;
  isMock: boolean;
  supportsOperations: string[];
  run: (request: ProviderRequest) => Promise<ProviderResponse>;
};

export type ProviderRegistry = {
  [C in ProviderCapability]: Array<ProviderAdapter<C>>;
};
