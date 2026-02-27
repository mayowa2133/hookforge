import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const EyeContactPreviewSchema = z.object({
  intensity: z.number().min(0).max(1).default(0.55),
  gazeTarget: z.enum(["camera", "slight_left", "slight_right"]).default("camera"),
  clipIds: z.array(z.string().min(1)).max(64).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = EyeContactPreviewSchema.parse(await request.json().catch(() => ({})));
    const ctx = await requireProjectContext(params.id);
    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "EYE_CONTACT",
      queueName: queueNameForJobType("EYE_CONTACT"),
      input: {
        mode: "preview",
        intensity: body.intensity,
        gazeTarget: body.gazeTarget,
        clipIds: body.clipIds ?? []
      }
    });

    return jsonOk(
      {
        mode: "preview",
        aiJobId: aiJob.id,
        status: aiJob.status
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

