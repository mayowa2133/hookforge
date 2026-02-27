import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const EyeContactApplySchema = z.object({
  intensity: z.number().min(0).max(1).default(0.6),
  gazeTarget: z.enum(["camera", "slight_left", "slight_right"]).default("camera"),
  previewJobId: z.string().min(1).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = EyeContactApplySchema.parse(await request.json().catch(() => ({})));
    const ctx = await requireProjectContext(params.id);
    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "EYE_CONTACT",
      queueName: queueNameForJobType("EYE_CONTACT"),
      input: {
        mode: "apply",
        intensity: body.intensity,
        gazeTarget: body.gazeTarget,
        previewJobId: body.previewJobId ?? null
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

