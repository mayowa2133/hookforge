import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { validateImportUrl } from "@/lib/media-import";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const GenerateAdSchema = z.object({
  websiteUrl: z.string().url(),
  productName: z.string().max(160).optional(),
  actorId: z.string().min(1).optional(),
  voiceId: z.string().min(1).optional(),
  tone: z.string().max(80).default("ugc")
});

export async function POST(request: Request) {
  try {
    const body = GenerateAdSchema.parse(await request.json());
    const parsedUrl = validateImportUrl(body.websiteUrl);
    const { user, workspace } = await requireUserWithWorkspace();

    const project = await prisma.projectV2.create({
      data: {
        workspaceId: workspace.id,
        createdByUserId: user.id,
        title: body.productName ? `AI Ad: ${body.productName}` : "AI Ad Draft",
        status: "DRAFT"
      }
    });

    const aiJob = await enqueueAIJob({
      workspaceId: workspace.id,
      projectId: project.id,
      type: "AI_ADS",
      queueName: queueNameForJobType("AI_ADS"),
      input: {
        ...body,
        websiteUrl: parsedUrl.toString()
      }
    });

    return jsonOk(
      {
        adProjectId: project.id,
        aiJobId: aiJob.id,
        status: aiJob.status,
        editableScript: null,
        editableMedia: []
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
