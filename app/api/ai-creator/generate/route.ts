import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const GenerateSchema = z
  .object({
    script: z.string().max(6000).optional(),
    prompt: z.string().max(3000).optional(),
    audioAssetId: z.string().min(1).optional(),
    actorId: z.string().min(1).optional(),
    voiceId: z.string().min(1).optional(),
    style: z.string().max(80).default("creator-default"),
    durationSec: z.number().min(3).max(180).default(30)
  })
  .refine((value) => Boolean(value.script || value.prompt || value.audioAssetId), {
    message: "Provide at least one of script, prompt, or audioAssetId"
  });

export async function POST(request: Request) {
  try {
    const body = GenerateSchema.parse(await request.json());
    const { user, workspace } = await requireUserWithWorkspace();

    const project = await prisma.projectV2.create({
      data: {
        workspaceId: workspace.id,
        createdByUserId: user.id,
        title: "AI Creator Draft",
        status: "DRAFT"
      }
    });

    const aiJob = await enqueueAIJob({
      workspaceId: workspace.id,
      projectId: project.id,
      type: "AI_CREATOR",
      queueName: queueNameForJobType("AI_CREATOR"),
      input: body
    });

    return jsonOk(
      {
        generatedProjectId: project.id,
        artifacts: [],
        aiJobId: aiJob.id,
        status: aiJob.status
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
