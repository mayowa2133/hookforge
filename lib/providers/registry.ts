import { env } from "../env";
import { createMockProvider } from "./mock";
import type { ProviderCapability, ProviderRegistry } from "./types";

const capabilityDefaults: Record<ProviderCapability, string[]> = {
  asr: ["deepgram", "whisper-fallback"],
  translation: ["llm-translation", "deterministic-fallback"],
  tts: ["elevenlabs", "tts-fallback"],
  voice_clone: ["elevenlabs-voice-clone"],
  lip_sync: ["sync-api", "lip-sync-fallback"],
  generative_media: ["gen-media-api", "gen-media-fallback"],
  music_sfx: ["music-sfx-provider", "music-sfx-fallback"]
};

const configuredFlags: Record<string, boolean> = {
  deepgram: Boolean(env.DEEPGRAM_API_KEY),
  whisperFallback: true,
  llmTranslation: Boolean(env.OPENAI_API_KEY),
  deterministicFallback: true,
  elevenlabs: Boolean(env.ELEVENLABS_API_KEY),
  ttsFallback: true,
  elevenlabsVoiceClone: Boolean(env.ELEVENLABS_API_KEY),
  syncApi: Boolean(env.LIPSYNC_API_KEY),
  lipSyncFallback: true,
  genMediaApi: Boolean(env.GENERATIVE_MEDIA_API_KEY),
  genMediaFallback: true,
  musicSfxProvider: Boolean(env.GENERATIVE_MEDIA_API_KEY),
  musicSfxFallback: true
};

function isConfigured(providerName: string) {
  if (providerName.startsWith("deepgram")) return configuredFlags.deepgram;
  if (providerName.startsWith("whisper")) return configuredFlags.whisperFallback;
  if (providerName.startsWith("llm")) return configuredFlags.llmTranslation;
  if (providerName.startsWith("deterministic")) return configuredFlags.deterministicFallback;
  if (providerName.startsWith("elevenlabs-voice")) return configuredFlags.elevenlabsVoiceClone;
  if (providerName.startsWith("elevenlabs")) return configuredFlags.elevenlabs;
  if (providerName.startsWith("sync")) return configuredFlags.syncApi;
  if (providerName.startsWith("lip-sync")) return configuredFlags.lipSyncFallback;
  if (providerName.startsWith("gen-media-api")) return configuredFlags.genMediaApi;
  if (providerName.startsWith("gen-media")) return configuredFlags.genMediaFallback;
  if (providerName.startsWith("music-sfx-provider")) return configuredFlags.musicSfxProvider;
  if (providerName.startsWith("music-sfx")) return configuredFlags.musicSfxFallback;
  return false;
}

export const providerRegistry: ProviderRegistry = {
  asr: capabilityDefaults.asr.map((name) => createMockProvider(name, "asr", isConfigured(name))),
  translation: capabilityDefaults.translation.map((name) => createMockProvider(name, "translation", isConfigured(name))),
  tts: capabilityDefaults.tts.map((name) => createMockProvider(name, "tts", isConfigured(name))),
  voice_clone: capabilityDefaults.voice_clone.map((name) => createMockProvider(name, "voice_clone", isConfigured(name))),
  lip_sync: capabilityDefaults.lip_sync.map((name) => createMockProvider(name, "lip_sync", isConfigured(name))),
  generative_media: capabilityDefaults.generative_media.map((name) => createMockProvider(name, "generative_media", isConfigured(name))),
  music_sfx: capabilityDefaults.music_sfx.map((name) => createMockProvider(name, "music_sfx", isConfigured(name)))
};

export function getPrimaryProvider(capability: ProviderCapability) {
  const providers = providerRegistry[capability];
  const configured = providers.find((provider) => provider.configured);
  return configured ?? providers[0];
}

export function getProviderByName(capability: ProviderCapability, providerName: string) {
  const providers = providerRegistry[capability];
  const matched = providers.find((provider) => provider.name === providerName);
  if (!matched) {
    return null;
  }
  return matched;
}

export function listProviders(capability: ProviderCapability) {
  return providerRegistry[capability];
}

export function getFallbackProvider(capability: ProviderCapability, excludeProviderName?: string) {
  const providers = providerRegistry[capability];
  const configured = providers.find(
    (provider) => provider.configured && provider.name !== excludeProviderName
  );
  if (configured) {
    return configured;
  }

  const firstAvailable = providers.find((provider) => provider.name !== excludeProviderName);
  return firstAvailable ?? null;
}
