import { env } from "../env";
import { createMockProvider } from "./mock";
import type { ProviderAdapter, ProviderCapability, ProviderRegistry } from "./types";
import {
  createDeepgramAsrAdapter,
  createElevenLabsTtsAdapter,
  createElevenLabsVoiceCloneAdapter,
  createGenerativeMediaAdapter,
  createLipSyncAdapter,
  createMusicSfxAdapter,
  createOpenAiTranslationAdapter
} from "./runtime-adapters";

const PROVIDER_TIMEOUT_MS = env.PROVIDER_HTTP_TIMEOUT_MS;

function runtimeIsNonDev() {
  const value = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (!value) {
    return false;
  }
  return value !== "development" && value !== "test";
}

export function realProviderEnforcementEnabled() {
  return runtimeIsNonDev() && !env.ALLOW_MOCK_PROVIDERS;
}

export const providerRegistry: ProviderRegistry = {
  asr: [
    createDeepgramAsrAdapter({
      apiKey: env.DEEPGRAM_API_KEY,
      baseUrl: env.DEEPGRAM_API_BASE_URL,
      timeoutMs: PROVIDER_TIMEOUT_MS
    }),
    createMockProvider("whisper-fallback", "asr", true)
  ],
  translation: [
    createOpenAiTranslationAdapter({
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_API_BASE_URL,
      timeoutMs: PROVIDER_TIMEOUT_MS
    }),
    createMockProvider("deterministic-fallback", "translation", true)
  ],
  tts: [
    createElevenLabsTtsAdapter({
      apiKey: env.ELEVENLABS_API_KEY,
      baseUrl: env.ELEVENLABS_API_BASE_URL,
      timeoutMs: PROVIDER_TIMEOUT_MS
    }),
    createMockProvider("tts-fallback", "tts", true)
  ],
  voice_clone: [
    createElevenLabsVoiceCloneAdapter({
      apiKey: env.ELEVENLABS_API_KEY,
      baseUrl: env.ELEVENLABS_VOICE_CLONE_BASE_URL,
      timeoutMs: PROVIDER_TIMEOUT_MS
    }),
    createMockProvider("voice-clone-fallback", "voice_clone", true)
  ],
  lip_sync: [
    createLipSyncAdapter({
      apiKey: env.LIPSYNC_API_KEY,
      endpointUrl: env.LIPSYNC_API_URL,
      timeoutMs: PROVIDER_TIMEOUT_MS
    }),
    createMockProvider("lip-sync-fallback", "lip_sync", true)
  ],
  generative_media: [
    createGenerativeMediaAdapter({
      apiKey: env.GENERATIVE_MEDIA_API_KEY,
      endpointUrl: env.GENERATIVE_MEDIA_API_URL,
      timeoutMs: PROVIDER_TIMEOUT_MS
    }),
    createMockProvider("gen-media-fallback", "generative_media", true)
  ],
  music_sfx: [
    createMusicSfxAdapter({
      apiKey: env.GENERATIVE_MEDIA_API_KEY,
      endpointUrl: env.MUSIC_SFX_API_URL,
      timeoutMs: PROVIDER_TIMEOUT_MS
    }),
    createMockProvider("music-sfx-fallback", "music_sfx", true)
  ]
};

function selectPreferredProvider(providers: ProviderAdapter[]) {
  const configuredReal = providers.find((provider) => provider.configured && !provider.isMock);
  if (configuredReal) {
    return configuredReal;
  }
  const configuredAny = providers.find((provider) => provider.configured);
  if (configuredAny) {
    return configuredAny;
  }
  return providers[0];
}

export function assertProviderAllowed(provider: ProviderAdapter, capability: ProviderCapability) {
  if (!realProviderEnforcementEnabled()) {
    return;
  }
  if (provider.isMock) {
    throw new Error(`Mock provider '${provider.name}' selected for '${capability}' in non-dev runtime.`);
  }
  if (!provider.configured) {
    throw new Error(`Provider '${provider.name}' for '${capability}' is not configured in non-dev runtime.`);
  }
}

export function getPrimaryProvider(capability: ProviderCapability) {
  const provider = selectPreferredProvider(providerRegistry[capability]);
  assertProviderAllowed(provider, capability);
  return provider;
}

export function getProviderByName(capability: ProviderCapability, providerName: string) {
  const providers = providerRegistry[capability];
  const matched = providers.find((provider) => provider.name === providerName);
  if (!matched) {
    return null;
  }
  assertProviderAllowed(matched, capability);
  return matched;
}

export function listProviders(capability: ProviderCapability) {
  return providerRegistry[capability];
}

export function getFallbackProvider(capability: ProviderCapability, excludeProviderName?: string) {
  const providers = providerRegistry[capability].filter((provider) => provider.name !== excludeProviderName);
  const configuredReal = providers.find((provider) => provider.configured && !provider.isMock);
  if (configuredReal) {
    return configuredReal;
  }
  if (realProviderEnforcementEnabled()) {
    return null;
  }
  const configured = providers.find((provider) => provider.configured);
  if (configured) {
    return configured;
  }
  return providers[0] ?? null;
}

export function summarizeProviderReadiness() {
  const capabilities = Object.keys(providerRegistry) as ProviderCapability[];
  const rows = capabilities.map((capability) => {
    const providers = providerRegistry[capability];
    const configuredRealCount = providers.filter((provider) => provider.configured && !provider.isMock).length;
    const configuredMockCount = providers.filter((provider) => provider.configured && provider.isMock).length;
    const primary = selectPreferredProvider(providers);
    return {
      capability,
      primaryProvider: primary?.name ?? null,
      primaryConfigured: primary?.configured ?? false,
      primaryIsMock: primary?.isMock ?? true,
      configuredRealCount,
      configuredMockCount,
      providerCount: providers.length
    };
  });

  return {
    enforcementEnabled: realProviderEnforcementEnabled(),
    allCapabilitiesHaveConfiguredRealProvider: rows.every((row) => row.configuredRealCount > 0),
    rows
  };
}
