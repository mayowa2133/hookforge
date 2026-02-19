import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { reserveCredits } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { validateImportUrl } from "@/lib/media-import";

export const runtime = "nodejs";

const DubbingSchema = z
  .object({
    sourceAssetId: z.string().min(1).optional(),
    sourceUrl: z.string().url().optional(),
    sourceLanguage: z.string().min(2).max(12).default("en"),
    targetLanguages: z.array(z.string().min(2).max(12)).min(1),
    lipDub: z.boolean().default(false)
  })
  .refine((value) => Boolean(value.sourceAssetId || value.sourceUrl), {
    message: "Provide sourceAssetId or sourceUrl"
  });

function estimateCredits(targetLanguageCount: number, lipDub: boolean) {
  return targetLanguageCount * 120 + (lipDub ? 80 : 0);
}

export async function POST(request: Request) {
  try {
    const body = DubbingSchema.parse(await request.json());
    const { workspace } = await requireUserWithWorkspace();

    if (!isSupportedLanguage(body.sourceLanguage)) {
      throw new Error(`Unsupported source language: ${body.sourceLanguage}`);
    }

    for (const language of body.targetLanguages) {
      if (!isSupportedLanguage(language)) {
        throw new Error(`Unsupported target language: ${language}`);
      }
    }

    const sourceUrl = body.sourceUrl ? validateImportUrl(body.sourceUrl).toString() : undefined;
    const estimatedCredits = estimateCredits(body.targetLanguages.length, body.lipDub);

    const aiJobType = body.lipDub ? "LIPSYNC" : "DUBBING";
    const aiJob = await enqueueAIJob({
      workspaceId: workspace.id,
      type: aiJobType,
      queueName: queueNameForJobType(aiJobType, body.lipDub),
      input: {
        sourceAssetId: body.sourceAssetId,
        sourceUrl,
        sourceLanguage: body.sourceLanguage,
        targetLanguages: body.targetLanguages,
        lipDub: body.lipDub
      }
    });

    await reserveCredits({
      workspaceId: workspace.id,
      feature: body.lipDub ? "dubbing.lipdub" : "dubbing.translate",
      amount: estimatedCredits,
      referenceType: "AIJob",
      referenceId: aiJob.id,
      metadata: {
        targetLanguages: body.targetLanguages,
        lipDub: body.lipDub
      }
    });

    return jsonOk(
      {
        jobId: aiJob.id,
        creditEstimate: estimatedCredits,
        status: aiJob.status,
        slaWindow: body.lipDub ? "15-45 minutes" : "5-20 minutes"
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
