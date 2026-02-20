import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { resolveWorkspaceTranslationProfile } from "@/lib/translation-profiles";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const TranslateCaptionSchema = z.object({
  sourceLanguage: z.string().min(2).max(12).default("en"),
  targetLanguages: z.array(z.string().min(2).max(12)).min(1),
  tone: z.string().max(120).optional(),
  glossary: z.record(z.string()).optional(),
  translationProfileId: z.string().min(1).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = TranslateCaptionSchema.parse(await request.json());

    if (!isSupportedLanguage(body.sourceLanguage)) {
      throw new Error(`Unsupported source language: ${body.sourceLanguage}`);
    }

    for (const language of body.targetLanguages) {
      if (!isSupportedLanguage(language)) {
        throw new Error(`Unsupported target language: ${language}`);
      }
    }

    const ctx = await requireProjectContext(params.id);
    const translationProfile = await resolveWorkspaceTranslationProfile({
      workspaceId: ctx.workspace.id,
      profileId: body.translationProfileId,
      sourceLanguage: body.sourceLanguage,
      tone: body.tone,
      glossary: body.glossary
    });

    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "CAPTION_TRANSLATE",
      queueName: queueNameForJobType("CAPTION_TRANSLATE"),
      input: {
        sourceLanguage: body.sourceLanguage,
        targetLanguages: body.targetLanguages,
        tone: body.tone,
        glossary: body.glossary,
        translationProfileId: body.translationProfileId,
        translationProfile
      }
    });

    return jsonOk(
      {
        translationJobId: aiJob.id,
        translatedTracks: body.targetLanguages.map((lang) => ({ language: lang, status: "QUEUED" })),
        translationProfile
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
