import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const MulticamApplySchema = z.object({
  segmentIds: z.array(z.string().min(1)).min(1).max(20),
  strategy: z.enum(["speaker_change", "emphasis", "balanced"]).default("balanced")
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = MulticamApplySchema.parse(await request.json());
    const ctx = await requireProjectContext(params.id);
    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "CHAT_EDIT",
      queueName: queueNameForJobType("CHAT_EDIT"),
      input: {
        mode: "multicam_apply",
        strategy: body.strategy,
        segmentIds: body.segmentIds
      }
    });

    return jsonOk(
      {
        mode: "apply",
        aiJobId: aiJob.id,
        status: aiJob.status
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

