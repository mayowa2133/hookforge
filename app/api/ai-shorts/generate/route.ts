import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { validateImportUrl } from "@/lib/media-import";

export const runtime = "nodejs";

const ShortsSchema = z
  .object({
    sourceAssetId: z.string().min(1).optional(),
    sourceUrl: z.string().url().optional(),
    clipCount: z.number().int().min(1).max(10).default(3),
    language: z.string().min(2).max(12).default("en")
  })
  .refine((value) => Boolean(value.sourceAssetId || value.sourceUrl), {
    message: "Provide sourceAssetId or sourceUrl"
  });

export async function POST(request: Request) {
  try {
    const body = ShortsSchema.parse(await request.json());
    const { workspace } = await requireUserWithWorkspace();

    if (!isSupportedLanguage(body.language)) {
      throw new Error(`Unsupported language: ${body.language}`);
    }

    const sourceUrl = body.sourceUrl ? validateImportUrl(body.sourceUrl).toString() : undefined;

    const aiJob = await enqueueAIJob({
      workspaceId: workspace.id,
      type: "AI_SHORTS",
      queueName: queueNameForJobType("AI_SHORTS"),
      input: {
        sourceAssetId: body.sourceAssetId,
        sourceUrl,
        clipCount: body.clipCount,
        language: body.language
      }
    });

    return jsonOk(
      {
        shortlistClips: [],
        confidence: 0,
        editableProjects: [],
        aiJobId: aiJob.id,
        status: aiJob.status
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
