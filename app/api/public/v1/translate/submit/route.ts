import { z } from "zod";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { estimatePhase5DubbingCredits, normalizeTargetLanguages } from "@/lib/ai/phase5";
import { reserveCredits } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { authenticatePublicApiKeyWithScope } from "@/lib/public-api";
import { validateImportUrl } from "@/lib/media-import";
import { resolveWorkspaceTranslationProfile } from "@/lib/translation-profiles";

export const runtime = "nodejs";

const TranslateSubmitSchema = z
  .object({
    sourceLanguage: z.string().min(2).max(12).default("en"),
    targetLanguages: z.array(z.string().min(2).max(12)).min(1),
    sourceMediaUrl: z.string().url().optional(),
    sourceStorageKey: z.string().min(1).optional(),
    lipDub: z.boolean().default(false),
    callbackUrl: z.string().url().optional(),
    tone: z.string().max(120).optional(),
    glossary: z.record(z.string()).optional(),
    translationProfileId: z.string().min(1).optional()
  })
  .refine((value) => Boolean(value.sourceMediaUrl || value.sourceStorageKey), {
    message: "Provide sourceMediaUrl or sourceStorageKey"
  });

export async function POST(request: Request) {
  try {
    const apiKey = await authenticatePublicApiKeyWithScope(request, "translate.submit");
    const body = TranslateSubmitSchema.parse(await request.json());

    if (!isSupportedLanguage(body.sourceLanguage)) {
      throw new Error(`Unsupported source language: ${body.sourceLanguage}`);
    }

    for (const language of body.targetLanguages) {
      if (!isSupportedLanguage(language)) {
        throw new Error(`Unsupported target language: ${language}`);
      }
    }

    const targetLanguages = normalizeTargetLanguages(body.targetLanguages);
    if (targetLanguages.length === 0) {
      throw new Error("No supported targetLanguages provided");
    }

    const sourceMediaUrl = body.sourceMediaUrl ? validateImportUrl(body.sourceMediaUrl).toString() : undefined;
    const translationProfile = await resolveWorkspaceTranslationProfile({
      workspaceId: apiKey.workspaceId,
      profileId: body.translationProfileId,
      sourceLanguage: body.sourceLanguage,
      tone: body.tone,
      glossary: body.glossary
    });

    const jobType = body.lipDub ? "LIPSYNC" : "DUBBING";
    const aiJob = await enqueueAIJob({
      workspaceId: apiKey.workspaceId,
      type: jobType,
      queueName: queueNameForJobType(jobType, body.lipDub),
      input: {
        sourceLanguage: body.sourceLanguage,
        targetLanguages,
        sourceMediaUrl,
        sourceStorageKey: body.sourceStorageKey,
        callbackUrl: body.callbackUrl,
        lipDub: body.lipDub,
        apiKeyId: apiKey.id,
        tone: body.tone,
        glossary: body.glossary,
        translationProfileId: body.translationProfileId,
        translationProfile
      }
    });

    const creditEstimate = estimatePhase5DubbingCredits({
      targetLanguageCount: targetLanguages.length,
      lipDub: body.lipDub,
      channel: "public"
    });
    await reserveCredits({
      workspaceId: apiKey.workspaceId,
      feature: "public-api.translate",
      amount: creditEstimate,
      referenceType: "AIJob",
      referenceId: aiJob.id,
      metadata: {
        lipDub: body.lipDub,
        targetLanguages
      }
    });

    return jsonOk(
      {
        jobId: aiJob.id,
        status: aiJob.status,
        creditEstimate,
        targetLanguages,
        translationProfile
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
