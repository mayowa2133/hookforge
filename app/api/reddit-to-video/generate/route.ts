import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { buildDeterministicShortlist, estimatePhase4ShortsCredits, extractRedditContext } from "@/lib/ai/phase4";
import { createSourceAttestation } from "@/lib/compliance";
import { reserveCredits } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { validateImportUrl } from "@/lib/media-import";

export const runtime = "nodejs";

const RedditSchema = z.object({
  redditUrl: z.string().url(),
  postTitle: z.string().max(280).optional(),
  postBody: z.string().max(4000).optional(),
  clipCount: z.number().int().min(1).max(5).default(3),
  language: z.string().min(2).max(12).default("en"),
  rightsAttested: z.boolean(),
  statement: z.string().min(12).max(600),
  sourceDurationSec: z.number().min(30).max(1800).default(180)
});

export async function POST(request: Request) {
  try {
    const body = RedditSchema.parse(await request.json());
    const parsed = validateImportUrl(body.redditUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes("reddit.com") && hostname !== "redd.it") {
      throw new Error("redditUrl must point to reddit.com or redd.it");
    }

    if (!isSupportedLanguage(body.language)) {
      throw new Error(`Unsupported language: ${body.language}`);
    }

    if (!body.rightsAttested) {
      throw new Error("rightsAttested must be true");
    }

    const { user, workspace } = await requireUserWithWorkspace();

    const attestation = await createSourceAttestation({
      workspaceId: workspace.id,
      userId: user.id,
      sourceUrl: parsed.toString(),
      sourceType: "REDDIT",
      statement: body.statement,
      flow: "reddit-to-video"
    });

    const context = extractRedditContext({
      redditUrl: parsed.toString(),
      postTitle: body.postTitle,
      postBody: body.postBody
    });

    const shortlist = buildDeterministicShortlist({
      sourceUrl: parsed.toString(),
      sourceType: "REDDIT",
      clipCount: body.clipCount,
      language: body.language,
      durationSec: body.sourceDurationSec
    });

    const aiJob = await enqueueAIJob({
      workspaceId: workspace.id,
      type: "AI_SHORTS",
      queueName: queueNameForJobType("AI_SHORTS"),
      input: {
        sourceType: "REDDIT",
        sourceUrl: parsed.toString(),
        clipCount: body.clipCount,
        language: body.language,
        sourceDurationSec: body.sourceDurationSec,
        redditContext: context,
        rightsAttestationId: attestation.rightsAttestation.id,
        flow: "reddit-to-video"
      }
    });

    const credits = estimatePhase4ShortsCredits({
      clipCount: body.clipCount,
      sourceType: "REDDIT"
    });

    await reserveCredits({
      workspaceId: workspace.id,
      feature: "reddit_to_video.generate",
      amount: credits,
      referenceType: "AIJob",
      referenceId: aiJob.id,
      metadata: {
        subreddit: context.subreddit,
        clipCount: body.clipCount,
        language: body.language
      }
    });

    return jsonOk(
      {
        aiJobId: aiJob.id,
        status: aiJob.status,
        creditEstimate: credits,
        context,
        shortlistClips: shortlist.clips,
        confidence: shortlist.confidence,
        editableProjects: []
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
