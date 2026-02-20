import { z } from "zod";
import { estimatePhase5DubbingCredits, normalizeTargetLanguages } from "@/lib/ai/phase5";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { authenticatePublicApiKey } from "@/lib/public-api";

export const runtime = "nodejs";

const TranslateEstimateSchema = z.object({
  sourceLanguage: z.string().min(2).max(12).default("en"),
  targetLanguages: z.array(z.string().min(2).max(12)).min(1),
  lipDub: z.boolean().default(false),
  durationSec: z.number().min(1).max(60 * 60).default(60)
});

export async function POST(request: Request) {
  try {
    const apiKey = await authenticatePublicApiKey(request);
    const body = TranslateEstimateSchema.parse(await request.json());

    if (!isSupportedLanguage(body.sourceLanguage)) {
      throw new Error(`Unsupported source language: ${body.sourceLanguage}`);
    }

    const targetLanguages = normalizeTargetLanguages(body.targetLanguages);
    if (targetLanguages.length === 0) {
      throw new Error("No supported targetLanguages provided");
    }

    const baseCredits = estimatePhase5DubbingCredits({
      targetLanguageCount: targetLanguages.length,
      lipDub: body.lipDub,
      channel: "public"
    });

    const minuteFactor = Math.max(1, Math.ceil(body.durationSec / 60));
    const estimatedCredits = baseCredits * minuteFactor;

    return jsonOk({
      workspaceId: apiKey.workspaceId,
      sourceLanguage: body.sourceLanguage,
      targetLanguages,
      lipDub: body.lipDub,
      durationSec: body.durationSec,
      estimate: {
        credits: estimatedCredits,
        baseCredits,
        minuteFactor
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
