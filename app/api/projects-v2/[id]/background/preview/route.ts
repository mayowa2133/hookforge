import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const BackgroundPreviewSchema = z.object({
  mode: z.enum(["replace", "blur", "remove"]).default("replace"),
  backgroundAssetId: z.string().min(1).optional(),
  strength: z.number().min(0).max(1).default(0.7)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = BackgroundPreviewSchema.parse(await request.json().catch(() => ({})));
    const ctx = await requireProjectContext(params.id);
    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "AI_EDIT",
      queueName: queueNameForJobType("AI_EDIT"),
      input: {
        mode: "background_preview",
        operation: body.mode,
        backgroundAssetId: body.backgroundAssetId ?? null,
        strength: body.strength
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

