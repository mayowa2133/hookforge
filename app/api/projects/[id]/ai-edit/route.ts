import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { routeErrorToResponse, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const AiEditSchema = z.object({
  styleId: z.string().min(2).max(80),
  colorProfile: z.string().max(60).optional(),
  includeBroll: z.boolean().default(true),
  includeMusic: z.boolean().default(true),
  includeSfx: z.boolean().default(true)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = AiEditSchema.parse(await request.json());
    const ctx = await requireProjectContext(params.id);

    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "AI_EDIT",
      queueName: queueNameForJobType("AI_EDIT"),
      input: {
        styleId: body.styleId,
        colorProfile: body.colorProfile,
        includeBroll: body.includeBroll,
        includeMusic: body.includeMusic,
        includeSfx: body.includeSfx
      }
    });

    return jsonOk(
      {
        aiEditJobId: aiJob.id,
        resultingRevisionId: null,
        status: aiJob.status
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
