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
    const { planJob, execution, safetyMode, confidenceRationale } = await createChatPlan(params.id, body.prompt, body.attachmentAssetIds ?? []);
    const output = (planJob.output ?? {}) as {
      planRevisionHash?: string;
      diffGroups?: unknown;
      safetyMode?: "APPLIED" | "APPLY_WITH_CONFIRM" | "SUGGESTIONS_ONLY";
      confidenceRationale?: unknown;
    };
    const validationIssues = execution.planValidation.reasons.map((reason) => ({
      code: "PLAN_VALIDATION",
      message: reason,
      severity: "WARN" as const
    }));

    return jsonOk({
      planId: planJob.id,
      planRevisionHash: output.planRevisionHash ?? null,
      confidence: execution.planValidation.averageConfidence,
      requiresConfirmation: true,
      executionMode: execution.executionMode,
      safetyMode: output.safetyMode ?? safetyMode,
      confidenceRationale: output.confidenceRationale ?? confidenceRationale,
      opsPreview: execution.appliedTimelineOperations,
      constrainedSuggestions: execution.constrainedSuggestions,
      diffGroups: Array.isArray(output.diffGroups) ? output.diffGroups : [],
      issues: [
        ...validationIssues,
        ...execution.invariantIssues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          severity: "ERROR" as const
        }))
      ]
    }, 202);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
