import { z } from "zod";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { reserveCredits } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { authenticatePublicApiKey } from "@/lib/public-api";
import { validateImportUrl } from "@/lib/media-import";

export const runtime = "nodejs";

const TranslateSubmitSchema = z
  .object({
    sourceLanguage: z.string().min(2).max(12).default("en"),
    targetLanguages: z.array(z.string().min(2).max(12)).min(1),
    sourceMediaUrl: z.string().url().optional(),
    sourceStorageKey: z.string().min(1).optional(),
    lipDub: z.boolean().default(false),
    callbackUrl: z.string().url().optional()
  })
  .refine((value) => Boolean(value.sourceMediaUrl || value.sourceStorageKey), {
    message: "Provide sourceMediaUrl or sourceStorageKey"
  });

function estimateCredits(languageCount: number, lipDub: boolean) {
  return languageCount * 100 + (lipDub ? 70 : 0);
}

export async function POST(request: Request) {
  try {
    const apiKey = await authenticatePublicApiKey(request);
    const body = TranslateSubmitSchema.parse(await request.json());

    if (!isSupportedLanguage(body.sourceLanguage)) {
      throw new Error(`Unsupported source language: ${body.sourceLanguage}`);
    }

    for (const language of body.targetLanguages) {
      if (!isSupportedLanguage(language)) {
        throw new Error(`Unsupported target language: ${language}`);
      }
    }

    const sourceMediaUrl = body.sourceMediaUrl ? validateImportUrl(body.sourceMediaUrl).toString() : undefined;

    const jobType = body.lipDub ? "LIPSYNC" : "DUBBING";
    const aiJob = await enqueueAIJob({
      workspaceId: apiKey.workspaceId,
      type: jobType,
      queueName: queueNameForJobType(jobType, body.lipDub),
      input: {
        sourceLanguage: body.sourceLanguage,
        targetLanguages: body.targetLanguages,
        sourceMediaUrl,
        sourceStorageKey: body.sourceStorageKey,
        callbackUrl: body.callbackUrl,
        lipDub: body.lipDub,
        apiKeyId: apiKey.id
      }
    });

    const creditEstimate = estimateCredits(body.targetLanguages.length, body.lipDub);
    await reserveCredits({
      workspaceId: apiKey.workspaceId,
      feature: "public-api.translate",
      amount: creditEstimate,
      referenceType: "AIJob",
      referenceId: aiJob.id,
      metadata: {
        lipDub: body.lipDub,
        targetLanguages: body.targetLanguages
      }
    });

    return jsonOk(
      {
        jobId: aiJob.id,
        status: aiJob.status,
        creditEstimate
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
