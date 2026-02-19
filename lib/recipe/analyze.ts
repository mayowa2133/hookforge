import { env } from "../env";
import { getTemplateDefinition, templateCatalog } from "../template-catalog";
import { probeMediaFile } from "../ffprobe";

export type HookRecipeResult = {
  metrics: {
    durationSec: number;
    sceneCutsEstimate: number;
    motionIntensity: "low" | "medium" | "high";
    textDensity: "low" | "medium" | "high";
  };
  bestTemplateSlug: string;
  reasoning: string[];
  recipeCard: {
    structure: string[];
    filmingTips: string[];
    caution: string[];
  };
  llmEnhancement?: {
    enabled: boolean;
    source: "mock" | "openai";
    summary: string;
  };
};

function estimateMotionIntensity(bitRate: number | null, fps: number | null): "low" | "medium" | "high" {
  const score = (bitRate ?? 1_000_000) / 1_000_000 + (fps ?? 24) / 24;
  if (score < 1.8) return "low";
  if (score < 3.2) return "medium";
  return "high";
}

function estimateTextDensity(
  durationSec: number,
  keyframeCount: number | null,
  motionIntensity: "low" | "medium" | "high"
): "low" | "medium" | "high" {
  const keyframeRate = keyframeCount ? keyframeCount / Math.max(durationSec, 1) : 0;
  if (motionIntensity === "low" && keyframeRate > 0.8) return "high";
  if (keyframeRate > 0.4) return "medium";
  if (motionIntensity === "high") return "low";
  return "medium";
}

function chooseTemplate({
  durationSec,
  sceneCutsEstimate,
  motionIntensity,
  textDensity
}: {
  durationSec: number;
  sceneCutsEstimate: number;
  motionIntensity: "low" | "medium" | "high";
  textDensity: "low" | "medium" | "high";
}) {
  if (sceneCutsEstimate >= 6 && durationSec <= 20) {
    return "three-beat-montage-intro-main-talk";
  }
  if (textDensity === "high") {
    return "tweet-comment-popup-reply";
  }
  if (motionIntensity === "low") {
    return "green-screen-commentator";
  }
  if (motionIntensity === "medium" && durationSec > 12) {
    return "split-screen-reaction";
  }
  return "fake-facetime-incoming-call";
}

async function maybeRunLlmEnhancer(heuristicSummary: string) {
  if (!env.ENABLE_LLM_RECIPE) {
    return undefined;
  }

  if (!env.OPENAI_API_KEY) {
    return {
      enabled: true,
      source: "mock" as const,
      summary: `LLM flag is enabled but no API key was provided. Heuristic summary used: ${heuristicSummary}`
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `Summarize this short-form hook analysis in <= 2 sentences: ${heuristicSummary}`,
        max_output_tokens: 120
      })
    });

    if (!response.ok) {
      return {
        enabled: true,
        source: "mock" as const,
        summary: `LLM request failed (${response.status}). Falling back to heuristic summary: ${heuristicSummary}`
      };
    }

    const payload = (await response.json()) as {
      output_text?: string;
    };

    return {
      enabled: true,
      source: "openai" as const,
      summary: payload.output_text ?? heuristicSummary
    };
  } catch {
    return {
      enabled: true,
      source: "mock" as const,
      summary: `Network unavailable. Falling back to heuristic summary: ${heuristicSummary}`
    };
  }
}

export async function analyzeReferenceHook(filePath: string): Promise<HookRecipeResult> {
  const probe = await probeMediaFile(filePath, { includeKeyframes: true });
  const durationSec = Math.max(1, Math.round((probe.durationSec ?? 8) * 10) / 10);

  const sceneCutsEstimate = Math.max(
    1,
    Math.round((probe.keyframeCount ?? Math.max(2, durationSec / 1.6)) * 0.9)
  );
  const motionIntensity = estimateMotionIntensity(probe.bitRate, probe.fps);
  const textDensity = estimateTextDensity(durationSec, probe.keyframeCount, motionIntensity);

  const bestTemplateSlug = chooseTemplate({
    durationSec,
    sceneCutsEstimate,
    motionIntensity,
    textDensity
  });

  const match = getTemplateDefinition(bestTemplateSlug) ?? templateCatalog[0];
  const heuristicSummary = `Duration ${durationSec}s, ${sceneCutsEstimate} scene transitions, motion ${motionIntensity}, text density ${textDensity}.`;

  const llmEnhancement = await maybeRunLlmEnhancer(heuristicSummary);

  return {
    metrics: {
      durationSec,
      sceneCutsEstimate,
      motionIntensity,
      textDensity
    },
    bestTemplateSlug,
    reasoning: [
      `Detected pacing suggests ${sceneCutsEstimate >= 6 ? "high tempo" : "steady tempo"} hook flow.`,
      `Motion intensity is ${motionIntensity}, text density is ${textDensity}.`,
      `Best structural template match: ${match.name}.`
    ],
    recipeCard: {
      structure: match.slotSchema.recipeCard.structure,
      filmingTips: match.slotSchema.recipeCard.filmingTips,
      caution: [
        "Upload only reference videos you own or have rights to analyze.",
        "HookForge copies structure only, never source pixels."
      ]
    },
    llmEnhancement
  };
}
