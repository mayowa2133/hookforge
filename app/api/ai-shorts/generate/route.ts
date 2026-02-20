import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { buildDeterministicShortlist, estimatePhase4ShortsCredits } from "@/lib/ai/phase4";
import { createSourceAttestation, detectSourceTypeFromUrl, type ComplianceSourceType } from "@/lib/compliance";
import { reserveCredits } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { validateImportUrl } from "@/lib/media-import";

export const runtime = "nodejs";

const ShortsSchema = z
  .object({
    sourceAssetId: z.string().min(1).optional(),
    sourceUrl: z.string().url().optional(),
    clipCount: z.number().int().min(1).max(5).default(3),
    language: z.string().min(2).max(12).default("en"),
    sourceDurationSec: z.number().min(30).max(1800).default(120),
    rightsAttested: z.boolean().optional(),
    statement: z.string().min(12).max(600).optional()
  })
  .refine((value) => Boolean(value.sourceAssetId || value.sourceUrl), {
    message: "Provide sourceAssetId or sourceUrl"
  });

export async function POST(request: Request) {
  try {
    const body = ShortsSchema.parse(await request.json());
    const { user, workspace } = await requireUserWithWorkspace();

    if (!isSupportedLanguage(body.language)) {
      throw new Error(`Unsupported language: ${body.language}`);
    }

    const sourceUrl = body.sourceUrl ? validateImportUrl(body.sourceUrl).toString() : undefined;
    const sourceType: ComplianceSourceType = sourceUrl ? detectSourceTypeFromUrl(sourceUrl) : "OTHER";

    let attestationId: string | null = null;
    if (sourceUrl) {
      if (!body.rightsAttested) {
        throw new Error("rightsAttested must be true for sourceUrl workflows");
      }
      if (!body.statement) {
        throw new Error("statement is required when sourceUrl is provided");
      }

      const attestation = await createSourceAttestation({
        workspaceId: workspace.id,
        userId: user.id,
        sourceUrl,
        sourceType,
        statement: body.statement,
        flow: "ai-shorts-generate"
      });
      attestationId = attestation.rightsAttestation.id;
    }

    const shortlist = buildDeterministicShortlist({
      sourceUrl,
      sourceType,
      clipCount: body.clipCount,
      language: body.language,
      durationSec: body.sourceDurationSec
    });

    const aiJob = await enqueueAIJob({
      workspaceId: workspace.id,
      type: "AI_SHORTS",
      queueName: queueNameForJobType("AI_SHORTS"),
      input: {
        sourceAssetId: body.sourceAssetId,
        sourceUrl,
        sourceType,
        clipCount: body.clipCount,
        language: body.language,
        sourceDurationSec: body.sourceDurationSec,
        rightsAttestationId: attestationId
      }
    });

    const credits = estimatePhase4ShortsCredits({
      clipCount: body.clipCount,
      sourceType
    });

    await reserveCredits({
      workspaceId: workspace.id,
      feature: sourceType === "REDDIT" ? "ai_shorts.reddit" : "ai_shorts.generate",
      amount: credits,
      referenceType: "AIJob",
      referenceId: aiJob.id,
      metadata: {
        sourceType,
        clipCount: body.clipCount,
        language: body.language
      }
    });

    return jsonOk(
      {
        shortlistClips: shortlist.clips,
        confidence: shortlist.confidence,
        editableProjects: [],
        aiJobId: aiJob.id,
        status: aiJob.status,
        creditEstimate: credits
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
