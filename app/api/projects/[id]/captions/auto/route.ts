import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const AutoCaptionSchema = z.object({
  language: z.string().min(2).max(12).default("en"),
  diarization: z.boolean().default(false),
  punctuationStyle: z.enum(["auto", "minimal", "full"]).default("auto")
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = AutoCaptionSchema.parse(await request.json());
    if (!isSupportedLanguage(body.language)) {
      throw new Error(`Unsupported language: ${body.language}`);
    }

    const ctx = await requireProjectContext(params.id);

    const captionTrack = await prisma.timelineTrack.create({
      data: {
        projectId: ctx.projectV2.id,
        revisionId: ctx.projectV2.currentRevisionId,
        kind: "CAPTION",
        name: `Auto captions (${body.language})`,
        sortOrder: 999
      }
    });

    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "TRANSCRIBE",
      queueName: queueNameForJobType("TRANSCRIBE"),
      input: {
        language: body.language,
        diarization: body.diarization,
        punctuationStyle: body.punctuationStyle,
        captionTrackId: captionTrack.id,
        legacyProjectId: ctx.legacyProject.id
      }
    });

    return jsonOk(
      {
        captionTrackId: captionTrack.id,
        wordsTimestamps: [],
        aiJobId: aiJob.id,
        status: aiJob.status
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
