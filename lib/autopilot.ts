import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import {
  applyChatPlanWithHash,
  createChatPlan,
  listChatSessions,
  undoChatPlanApplyWithMode,
  type ChatPlanOperationDecision
} from "@/lib/chat-v2";
import { prisma } from "@/lib/prisma";

export const AutopilotPlanSchema = z.object({
  prompt: z.string().trim().min(4).max(1000),
  attachmentAssetIds: z.array(z.string().min(1)).max(20).optional()
});

export const AutopilotApplySchema = z.object({
  sessionId: z.string().min(1),
  planRevisionHash: z.string().min(8),
  confirmed: z.literal(true),
  operationDecisions: z.array(
    z.object({
      itemId: z.string().min(1),
      accepted: z.boolean()
    })
  ).max(400).optional()
});

export const AutopilotUndoSchema = z.object({
  sessionId: z.string().min(1).optional(),
  undoToken: z.string().min(8),
  force: z.boolean().optional()
});

function toAutopilotStatus(params: { applied: boolean; suggestionsOnly: boolean }) {
  if (params.suggestionsOnly) {
    return "SUGGESTIONS_ONLY" as const;
  }
  if (params.applied) {
    return "SUCCESS" as const;
  }
  return "FAILED" as const;
}

export async function createAutopilotPlan(projectIdOrV2Id: string, input: z.infer<typeof AutopilotPlanSchema>) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const plan = await createChatPlan(ctx.projectV2.id, input.prompt, input.attachmentAssetIds ?? []);
  const output = (plan.planJob.output ?? {}) as {
    planRevisionHash?: string;
    diffGroups?: unknown;
    confidenceRationale?: unknown;
  };
  const session = await prisma.autopilotSession.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      prompt: input.prompt,
      sourcePlanId: plan.planJob.id,
      planRevisionHash: output.planRevisionHash ?? "",
      safetyMode: plan.safetyMode,
      confidence: plan.execution.planValidation.averageConfidence,
      status: plan.execution.executionMode === "SUGGESTIONS_ONLY" ? "SUGGESTIONS_ONLY" : "SUCCESS",
      createdByUserId: ctx.user.id,
      metadata: {
        confidenceRationale: output.confidenceRationale ?? plan.confidenceRationale,
        diffGroups: output.diffGroups ?? plan.diffGroups,
        executionMode: plan.execution.executionMode
      }
    }
  });
  await prisma.autopilotAction.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      sessionId: session.id,
      actionType: "PLAN",
      status: session.status,
      payload: {
        planId: plan.planJob.id,
        planRevisionHash: session.planRevisionHash,
        safetyMode: session.safetyMode,
        confidence: session.confidence
      }
    }
  });

  return {
    sessionId: session.id,
    planId: plan.planJob.id,
    planRevisionHash: session.planRevisionHash,
    safetyMode: session.safetyMode,
    confidence: session.confidence,
    confidenceRationale: output.confidenceRationale ?? plan.confidenceRationale,
    diffGroups: output.diffGroups ?? plan.diffGroups,
    opsPreview: plan.execution.appliedTimelineOperations,
    constrainedSuggestions: plan.execution.constrainedSuggestions
  };
}

export async function applyAutopilotPlan(params: {
  projectIdOrV2Id: string;
  sessionId: string;
  planRevisionHash: string;
  operationDecisions?: ChatPlanOperationDecision[];
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const session = await prisma.autopilotSession.findFirst({
    where: {
      id: params.sessionId,
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id
    }
  });
  if (!session || !session.sourcePlanId) {
    throw new Error("Autopilot session not found");
  }
  const result = await applyChatPlanWithHash(
    ctx.projectV2.id,
    session.sourcePlanId,
    params.planRevisionHash,
    params.operationDecisions
  );

  const status = toAutopilotStatus({
    applied: result.applied,
    suggestionsOnly: result.suggestionsOnly
  });

  await prisma.$transaction([
    prisma.autopilotSession.update({
      where: { id: session.id },
      data: {
        status,
        metadata: {
          ...(session.metadata && typeof session.metadata === "object" ? session.metadata : {}),
          lastApplyResult: result
        }
      }
    }),
    prisma.autopilotAction.create({
      data: {
        workspaceId: ctx.workspace.id,
        projectId: ctx.projectV2.id,
        sessionId: session.id,
        actionType: "APPLY",
        status,
        payload: result,
        errorMessage: result.applied ? null : result.issues.map((issue) => issue.message).join("; ")
      }
    })
  ]);

  return {
    sessionId: session.id,
    ...result
  };
}

export async function undoAutopilotPlan(params: {
  projectIdOrV2Id: string;
  undoToken: string;
  force?: boolean;
  sessionId?: string;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const result = await undoChatPlanApplyWithMode(ctx.projectV2.id, params.undoToken, Boolean(params.force));

  if (params.sessionId) {
    await prisma.autopilotAction.create({
      data: {
        workspaceId: ctx.workspace.id,
        projectId: ctx.projectV2.id,
        sessionId: params.sessionId,
        actionType: "UNDO",
        status: result.restored ? "SUCCESS" : "FAILED",
        payload: result
      }
    });
  }

  return result;
}

export async function listAutopilotSessions(projectIdOrV2Id: string, limit = 30) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const sessions = await prisma.autopilotSession.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id
    },
    orderBy: {
      createdAt: "desc"
    },
    take: Math.max(1, Math.min(limit, 100))
  });

  const actions = await prisma.autopilotAction.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      sessionId: {
        in: sessions.map((entry) => entry.id)
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 400
  });

  const chatSessions = await listChatSessions(ctx.projectV2.id, 50);

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    sessions: sessions.map((session) => ({
      id: session.id,
      prompt: session.prompt,
      sourcePlanId: session.sourcePlanId,
      planRevisionHash: session.planRevisionHash,
      safetyMode: session.safetyMode,
      confidence: session.confidence,
      status: session.status,
      metadata: session.metadata,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      actions: actions
        .filter((action) => action.sessionId === session.id)
        .slice(0, 10)
        .map((action) => ({
          id: action.id,
          actionType: action.actionType,
          status: action.status,
          payload: action.payload,
          errorMessage: action.errorMessage,
          createdAt: action.createdAt.toISOString()
        }))
    })),
    linkedChatSessions: chatSessions.sessions
  };
}
