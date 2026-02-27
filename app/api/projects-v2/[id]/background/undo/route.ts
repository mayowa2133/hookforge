import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const BackgroundUndoSchema = z.object({
  sourceJobId: z.string().min(1)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = BackgroundUndoSchema.parse(await request.json());
    const ctx = await requireProjectContext(params.id);
    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "AI_EDIT",
      queueName: queueNameForJobType("AI_EDIT"),
      input: {
        mode: "background_undo",
        sourceJobId: body.sourceJobId
      }
    });

    return jsonOk(
      {
        mode: "undo",
        aiJobId: aiJob.id,
        status: aiJob.status
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

