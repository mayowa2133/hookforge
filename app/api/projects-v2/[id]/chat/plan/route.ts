import { z } from "zod";
import { createChatPlan } from "@/lib/chat-v2";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const ChatPlanSchema = z.object({
  prompt: z.string().min(4).max(1000),
  attachmentAssetIds: z.array(z.string().min(1)).max(20).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = ChatPlanSchema.parse(await request.json());
    const { planJob, execution } = await createChatPlan(params.id, body.prompt, body.attachmentAssetIds ?? []);

    return jsonOk({
      planId: planJob.id,
      confidence: execution.planValidation.averageConfidence,
      requiresConfirmation: true,
      executionMode: execution.executionMode,
      opsPreview: execution.appliedTimelineOperations,
      constrainedSuggestions: execution.constrainedSuggestions,
      issues: execution.invariantIssues
    }, 202);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
