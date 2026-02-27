import type { ProviderAdapter, ProviderCapability, ProviderRequest, ProviderResponse } from "@/lib/providers/types";
import { validateProviderPayload } from "@/lib/providers/contracts";

function coerceUrl(url: string | undefined | null) {
  const normalized = (url ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function nowMs() {
  return Date.now();
}

function buildUsage(params: { startedAtMs: number; output: unknown; fallbackCostUsd?: number }) {
  const durationMs = Math.max(1, nowMs() - params.startedAtMs);
  const outputLength = typeof params.output === "string"
    ? params.output.length
    : JSON.stringify(params.output ?? {}).length;
  return {
    durationMs,
    tokensIn: undefined,
    tokensOut: Math.max(20, Math.floor(outputLength / 4)),
    costUsd: params.fallbackCostUsd
  };
}

async function postJson(params: {
  url: string;
  apiKey: string;
  apiKeyHeader: string;
  payload: unknown;
  timeoutMs: number;
  extraHeaders?: Record<string, string>;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("provider-timeout"), params.timeoutMs);
  try {
    const response = await fetch(params.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [params.apiKeyHeader]: params.apiKey,
        ...(params.extraHeaders ?? {})
      },
      body: JSON.stringify(params.payload),
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text();
    if (!response.ok) {
      throw new Error(`Provider HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function createAdapter<C extends ProviderCapability>(params: {
  name: string;
  capability: C;
  configured: boolean;
  supportsOperations: string[];
  runConfigured: (request: ProviderRequest) => Promise<ProviderResponse>;
  runUnconfiguredFallback?: (request: ProviderRequest) => Promise<ProviderResponse>;
}): ProviderAdapter<C> {
  return {
    name: params.name,
    capability: params.capability,
    configured: params.configured,
    isMock: false,
    supportsOperations: params.supportsOperations,
    async run(request) {
      validateProviderPayload(params.capability, request.payload);
      if (params.configured) {
        return params.runConfigured(request);
      }
      if (params.runUnconfiguredFallback) {
        return params.runUnconfiguredFallback(request);
      }
      throw new Error(`${params.name} provider is not configured`);
    }
  };
}

export function createDeepgramAsrAdapter(params: {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
}) {
  const apiKey = (params.apiKey ?? "").trim();
  const baseUrl = coerceUrl(params.baseUrl) ?? "https://api.deepgram.com/v1/listen";
  return createAdapter({
    name: "deepgram",
    capability: "asr",
    configured: apiKey.length > 0,
    supportsOperations: ["TRANSCRIBE"],
    async runConfigured(request) {
      const startedAtMs = nowMs();
      const payload = validateProviderPayload("asr", request.payload);
      const externalBody = await postJson({
        url: baseUrl,
        apiKey,
        apiKeyHeader: "Authorization",
        payload: {
          ...(payload.audioUrl ? { url: payload.audioUrl } : {}),
          metadata: {
            language: payload.language ?? "en",
            diarization: payload.diarization ?? false,
            punctuationStyle: payload.punctuationStyle ?? "auto",
            durationMs: payload.durationMs ?? null,
            decodeAttempt: payload.decodeAttempt ?? null
          }
        },
        timeoutMs: params.timeoutMs,
        extraHeaders: {
          Authorization: `Token ${apiKey}`
        }
      });

      return {
        providerName: "deepgram",
        model: "deepgram-listen",
        output: typeof externalBody === "object" && externalBody !== null
          ? (externalBody as Record<string, unknown>)
          : { raw: externalBody },
        usage: buildUsage({
          startedAtMs,
          output: externalBody
        })
      };
    },
    async runUnconfiguredFallback(request) {
      const payload = validateProviderPayload("asr", request.payload);
      return {
        providerName: "deepgram",
        model: "deepgram-unconfigured",
        output: {
          operation: request.operation,
          accepted: true,
          synthetic: true,
          language: payload.language ?? "en",
          durationMs: payload.durationMs ?? null,
          note: "Deepgram key missing. Returned deterministic bridge output for local workflows."
        },
        usage: {
          durationMs: 120,
          tokensOut: 64,
          costUsd: 0
        }
      };
    }
  });
}

export function createOpenAiTranslationAdapter(params: {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
}) {
  const apiKey = (params.apiKey ?? "").trim();
  const baseUrl = coerceUrl(params.baseUrl) ?? "https://api.openai.com/v1/responses";
  return createAdapter({
    name: "llm-translation",
    capability: "translation",
    configured: apiKey.length > 0,
    supportsOperations: ["CAPTION_TRANSLATE", "DUBBING", "public_translate"],
    async runConfigured(request) {
      const startedAtMs = nowMs();
      const payload = validateProviderPayload("translation", request.payload);
      const text = (payload.text ?? "").trim();
      const sourceLanguage = (payload.sourceLanguage ?? "auto").trim();
      const targetLanguage = (payload.targetLanguage ?? "en").trim();
      const tone = (payload.tone ?? "neutral").trim();
      const glossary = payload.glossary ?? {};

      const externalBody = await postJson({
        url: baseUrl,
        apiKey,
        apiKeyHeader: "Authorization",
        payload: {
          model: "gpt-4.1-mini",
          input: [
            {
              role: "system",
              content: "Translate faithfully. Preserve meaning, punctuation timing hints, and glossary terms."
            },
            {
              role: "user",
              content: JSON.stringify({
                text,
                sourceLanguage,
                targetLanguage,
                tone,
                glossary
              })
            }
          ]
        },
        timeoutMs: params.timeoutMs,
        extraHeaders: {
          Authorization: `Bearer ${apiKey}`
        }
      });

      return {
        providerName: "llm-translation",
        model: "gpt-4.1-mini",
        output: typeof externalBody === "object" && externalBody !== null
          ? (externalBody as Record<string, unknown>)
          : { raw: externalBody },
        usage: buildUsage({
          startedAtMs,
          output: externalBody
        })
      };
    },
    async runUnconfiguredFallback(request) {
      const payload = validateProviderPayload("translation", request.payload);
      return {
        providerName: "llm-translation",
        model: "llm-translation-unconfigured",
        output: {
          operation: request.operation,
          accepted: true,
          synthetic: true,
          translatedText: payload.text ?? "",
          targetLanguage: payload.targetLanguage ?? "en",
          note: "OpenAI key missing. Returned pass-through deterministic translation output."
        },
        usage: {
          durationMs: 100,
          tokensOut: 48,
          costUsd: 0
        }
      };
    }
  });
}

export function createElevenLabsTtsAdapter(params: {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
}) {
  const apiKey = (params.apiKey ?? "").trim();
  const baseUrl = coerceUrl(params.baseUrl) ?? "https://api.elevenlabs.io/v1/text-to-speech";
  return createAdapter({
    name: "elevenlabs",
    capability: "tts",
    configured: apiKey.length > 0,
    supportsOperations: ["TTS", "AI_CREATOR"],
    async runConfigured(request) {
      const startedAtMs = nowMs();
      const payload = validateProviderPayload("tts", request.payload);
      const voiceId = (payload.voiceId ?? "default").trim();
      const text = (payload.text ?? "").trim();

      const externalBody = await postJson({
        url: `${baseUrl}/${encodeURIComponent(voiceId)}`,
        apiKey,
        apiKeyHeader: "xi-api-key",
        payload: {
          text,
          model_id: "eleven_multilingual_v2"
        },
        timeoutMs: params.timeoutMs
      });

      return {
        providerName: "elevenlabs",
        model: "eleven_multilingual_v2",
        output: typeof externalBody === "object" && externalBody !== null
          ? (externalBody as Record<string, unknown>)
          : { raw: externalBody },
        usage: buildUsage({
          startedAtMs,
          output: externalBody
        })
      };
    },
    async runUnconfiguredFallback(request) {
      return {
        providerName: "elevenlabs",
        model: "elevenlabs-unconfigured",
        output: {
          operation: request.operation,
          accepted: true,
          synthetic: true,
          note: "ElevenLabs key missing. Returned deterministic TTS bridge output."
        },
        usage: {
          durationMs: 95,
          tokensOut: 36,
          costUsd: 0
        }
      };
    }
  });
}

export function createElevenLabsVoiceCloneAdapter(params: {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
}) {
  const apiKey = (params.apiKey ?? "").trim();
  const baseUrl = coerceUrl(params.baseUrl) ?? "https://api.elevenlabs.io/v1/voices/add";
  return createAdapter({
    name: "elevenlabs-voice-clone",
    capability: "voice_clone",
    configured: apiKey.length > 0,
    supportsOperations: ["VOICE_CLONE"],
    async runConfigured(request) {
      const startedAtMs = nowMs();
      const payload = validateProviderPayload("voice_clone", request.payload);
      const externalBody = await postJson({
        url: baseUrl,
        apiKey,
        apiKeyHeader: "xi-api-key",
        payload: {
          name: payload.voiceName ?? "HookForge Voice",
          files: payload.sampleUrl ? [payload.sampleUrl] : []
        },
        timeoutMs: params.timeoutMs
      });
      return {
        providerName: "elevenlabs-voice-clone",
        model: "voice_clone_v1",
        output: typeof externalBody === "object" && externalBody !== null
          ? (externalBody as Record<string, unknown>)
          : { raw: externalBody },
        usage: buildUsage({
          startedAtMs,
          output: externalBody
        })
      };
    },
    async runUnconfiguredFallback(request) {
      const payload = validateProviderPayload("voice_clone", request.payload);
      return {
        providerName: "elevenlabs-voice-clone",
        model: "voice-clone-unconfigured",
        output: {
          operation: request.operation,
          accepted: true,
          synthetic: true,
          voiceName: payload.voiceName ?? "HookForge Voice",
          note: "ElevenLabs key missing. Returned deterministic voice clone bridge output."
        },
        usage: {
          durationMs: 110,
          tokensOut: 40,
          costUsd: 0
        }
      };
    }
  });
}

export function createLipSyncAdapter(params: {
  apiKey?: string;
  endpointUrl?: string;
  timeoutMs: number;
}) {
  const apiKey = (params.apiKey ?? "").trim();
  const endpointUrl = coerceUrl(params.endpointUrl);
  const configured = apiKey.length > 0 && endpointUrl !== null;
  return createAdapter({
    name: "sync-api",
    capability: "lip_sync",
    configured,
    supportsOperations: ["LIPSYNC"],
    async runConfigured(request) {
      const startedAtMs = nowMs();
      const payload = validateProviderPayload("lip_sync", request.payload);
      const externalBody = await postJson({
        url: endpointUrl as string,
        apiKey,
        apiKeyHeader: "Authorization",
        payload,
        timeoutMs: params.timeoutMs,
        extraHeaders: {
          Authorization: `Bearer ${apiKey}`
        }
      });
      return {
        providerName: "sync-api",
        model: "lip-sync-api-v1",
        output: typeof externalBody === "object" && externalBody !== null
          ? (externalBody as Record<string, unknown>)
          : { raw: externalBody },
        usage: buildUsage({
          startedAtMs,
          output: externalBody
        })
      };
    },
    async runUnconfiguredFallback(request) {
      return {
        providerName: "sync-api",
        model: "lip-sync-unconfigured",
        output: {
          operation: request.operation,
          accepted: true,
          synthetic: true,
          note: "Lip sync endpoint not configured. Returned deterministic bridge output."
        },
        usage: {
          durationMs: 130,
          tokensOut: 52,
          costUsd: 0
        }
      };
    }
  });
}

export function createGenerativeMediaAdapter(params: {
  apiKey?: string;
  endpointUrl?: string;
  timeoutMs: number;
}) {
  const apiKey = (params.apiKey ?? "").trim();
  const endpointUrl = coerceUrl(params.endpointUrl);
  const configured = apiKey.length > 0 && endpointUrl !== null;
  return createAdapter({
    name: "gen-media-api",
    capability: "generative_media",
    configured,
    supportsOperations: ["AI_CREATOR", "AI_ADS", "AI_SHORTS", "CHAT_EDIT", "AI_EDIT", "EYE_CONTACT"],
    async runConfigured(request) {
      const startedAtMs = nowMs();
      const payload = validateProviderPayload("generative_media", request.payload);
      const externalBody = await postJson({
        url: endpointUrl as string,
        apiKey,
        apiKeyHeader: "Authorization",
        payload: {
          operation: request.operation,
          input: payload
        },
        timeoutMs: params.timeoutMs,
        extraHeaders: {
          Authorization: `Bearer ${apiKey}`
        }
      });
      return {
        providerName: "gen-media-api",
        model: "gen-media-v1",
        output: typeof externalBody === "object" && externalBody !== null
          ? (externalBody as Record<string, unknown>)
          : { raw: externalBody },
        usage: buildUsage({
          startedAtMs,
          output: externalBody
        })
      };
    },
    async runUnconfiguredFallback(request) {
      return {
        providerName: "gen-media-api",
        model: "gen-media-unconfigured",
        output: {
          operation: request.operation,
          accepted: true,
          synthetic: true,
          note: "Generative media endpoint not configured. Returned deterministic bridge output."
        },
        usage: {
          durationMs: 140,
          tokensOut: 60,
          costUsd: 0
        }
      };
    }
  });
}

export function createMusicSfxAdapter(params: {
  apiKey?: string;
  endpointUrl?: string;
  timeoutMs: number;
}) {
  const apiKey = (params.apiKey ?? "").trim();
  const endpointUrl = coerceUrl(params.endpointUrl);
  const configured = apiKey.length > 0 && endpointUrl !== null;
  return createAdapter({
    name: "music-sfx-provider",
    capability: "music_sfx",
    configured,
    supportsOperations: ["DENOISE", "MUSIC_SFX"],
    async runConfigured(request) {
      const startedAtMs = nowMs();
      const payload = validateProviderPayload("music_sfx", request.payload);
      const externalBody = await postJson({
        url: endpointUrl as string,
        apiKey,
        apiKeyHeader: "Authorization",
        payload: {
          operation: request.operation,
          input: payload
        },
        timeoutMs: params.timeoutMs,
        extraHeaders: {
          Authorization: `Bearer ${apiKey}`
        }
      });
      return {
        providerName: "music-sfx-provider",
        model: "music-sfx-v1",
        output: typeof externalBody === "object" && externalBody !== null
          ? (externalBody as Record<string, unknown>)
          : { raw: externalBody },
        usage: buildUsage({
          startedAtMs,
          output: externalBody
        })
      };
    },
    async runUnconfiguredFallback(request) {
      return {
        providerName: "music-sfx-provider",
        model: "music-sfx-unconfigured",
        output: {
          operation: request.operation,
          accepted: true,
          synthetic: true,
          note: "Music/SFX endpoint not configured. Returned deterministic bridge output."
        },
        usage: {
          durationMs: 125,
          tokensOut: 44,
          costUsd: 0
        }
      };
    }
  });
}
