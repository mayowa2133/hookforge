export type ProviderCapability =
  | "asr"
  | "translation"
  | "tts"
  | "voice_clone"
  | "lip_sync"
  | "generative_media"
  | "music_sfx";

export type ProviderRequest = {
  operation: string;
  payload: Record<string, unknown>;
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

export type ProviderAdapter = {
  name: string;
  capability: ProviderCapability;
  configured: boolean;
  run: (request: ProviderRequest) => Promise<ProviderResponse>;
};

export type ProviderRegistry = Record<ProviderCapability, ProviderAdapter[]>;
