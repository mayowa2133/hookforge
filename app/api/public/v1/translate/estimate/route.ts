import { z } from "zod";
import { estimatePhase5DubbingCredits, normalizeTargetLanguages } from "@/lib/ai/phase5";
import { buildDubbingAdaptationPlan, estimateDubbingMos } from "@/lib/ai/phase5-quality";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { authenticatePublicApiKeyWithScope } from "@/lib/public-api";
import { resolveWorkspaceTranslationProfile } from "@/lib/translation-profiles";

export const runtime = "nodejs";

const TranslateEstimateSchema = z.object({
  sourceLanguage: z.string().min(2).max(12).default("en"),
  targetLanguages: z.array(z.string().min(2).max(12)).min(1),
  lipDub: z.boolean().default(false),
  durationSec: z.number().min(1).max(60 * 60).default(60),
  tone: z.string().max(120).optional(),
  glossary: z.record(z.string()).optional(),
  translationProfileId: z.string().min(1).optional()
});

export async function POST(request: Request) {
  try {
    const apiKey = await authenticatePublicApiKeyWithScope(request, "translate.estimate");
    const body = TranslateEstimateSchema.parse(await request.json());

    if (!isSupportedLanguage(body.sourceLanguage)) {
      throw new Error(`Unsupported source language: ${body.sourceLanguage}`);
    }

    const targetLanguages = normalizeTargetLanguages(body.targetLanguages);
    if (targetLanguages.length === 0) {
      throw new Error("No supported targetLanguages provided");
    }

    const translationProfile = await resolveWorkspaceTranslationProfile({
      workspaceId: apiKey.workspaceId,
      profileId: body.translationProfileId,
      sourceLanguage: body.sourceLanguage,
      tone: body.tone,
      glossary: body.glossary
    });

    const baseCredits = estimatePhase5DubbingCredits({
      targetLanguageCount: targetLanguages.length,
      lipDub: body.lipDub,
      channel: "public"
    });

    const minuteFactor = Math.max(1, Math.ceil(body.durationSec / 60));
    const estimatedCredits = baseCredits * minuteFactor;
    const adaptationPreview = buildDubbingAdaptationPlan({
      sourceDurationSec: body.durationSec,
      sourceLanguage: body.sourceLanguage,
      targetLanguage: targetLanguages[0],
      lipDub: body.lipDub,
      tone: translationProfile.tone,
      glossarySize: Object.keys(translationProfile.glossary).length
    });
    const estimatedMos = estimateDubbingMos({
      adaptationPlan: adaptationPreview,
      lipDub: body.lipDub
    });

    return jsonOk({
      workspaceId: apiKey.workspaceId,
      sourceLanguage: body.sourceLanguage,
      targetLanguages,
      lipDub: body.lipDub,
      durationSec: body.durationSec,
      estimate: {
        credits: estimatedCredits,
        baseCredits,
        minuteFactor,
        estimatedMos,
        adaptationPreview
      },
      translationProfile
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
