import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const EyeContactUndoSchema = z.object({
  sourceJobId: z.string().min(1)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = EyeContactUndoSchema.parse(await request.json());
    const ctx = await requireProjectContext(params.id);
    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "EYE_CONTACT",
      queueName: queueNameForJobType("EYE_CONTACT"),
      input: {
        mode: "undo",
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

