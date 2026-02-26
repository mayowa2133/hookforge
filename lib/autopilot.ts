import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import {
  applyChatPlanWithHash,
  createChatPlan,
  listChatSessions,
  undoChatPlanApplyWithMode,
  type ChatPlanOperationDecision
} from "@/lib/chat-v2";
import {
  appendPublishingDiffGroup,
  AutopilotMacroArgsSchema,
  AutopilotMacroIdSchema,
  AutopilotPlannerPackSchema,
  getTimelineOperationItemIds,
  resolveAutopilotPrompt,
  type AutopilotDiffGroup
} from "@/lib/autopilot-tools";
import { prisma } from "@/lib/prisma";

export const AutopilotPlanSchema = z.object({
  prompt: z.string().trim().min(4).max(1000).optional(),
  plannerPack: AutopilotPlannerPackSchema.optional(),
  macroId: AutopilotMacroIdSchema.optional(),
  macroArgs: AutopilotMacroArgsSchema,
  attachmentAssetIds: z.array(z.string().min(1)).max(20).optional()
}).refine(
  (value) => Boolean(value.prompt?.trim()) || Boolean(value.macroId),
  "Autopilot requires either prompt or macroId."
);

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

export const AutopilotReplaySchema = z.object({
  sessionId: z.string().min(1),
  confirmed: z.literal(true),
  applyImmediately: z.boolean().optional(),
  reuseOperationDecisions: z.boolean().optional()
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
  const resolved = resolveAutopilotPrompt({
    prompt: input.prompt,
    plannerPack: input.plannerPack,
    macroId: input.macroId,
    macroArgs: input.macroArgs
  });
  const plan = await createChatPlan(ctx.projectV2.id, resolved.resolvedPrompt, input.attachmentAssetIds ?? []);
  const output = (plan.planJob.output ?? {}) as {
    planRevisionHash?: string;
    diffGroups?: unknown;
    confidenceRationale?: unknown;
  };
  const rawDiffGroups = Array.isArray(output.diffGroups)
    ? (output.diffGroups as AutopilotDiffGroup[])
    : (plan.diffGroups as unknown as AutopilotDiffGroup[]);
  const diffGroups = appendPublishingDiffGroup({
    groups: rawDiffGroups,
    plannerPack: resolved.plannerPack,
    constrainedSuggestions: plan.execution.constrainedSuggestions
  });
  const session = await prisma.autopilotSession.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      prompt: resolved.originalPrompt,
      sourcePlanId: plan.planJob.id,
      planRevisionHash: output.planRevisionHash ?? "",
      safetyMode: plan.safetyMode,
      confidence: plan.execution.planValidation.averageConfidence,
      status: plan.execution.executionMode === "SUGGESTIONS_ONLY" ? "SUGGESTIONS_ONLY" : "SUCCESS",
      createdByUserId: ctx.user.id,
      metadata: {
        plannerPack: resolved.plannerPack,
        macroId: resolved.macroId,
        macroLabel: resolved.macroLabel,
        macroArgs: resolved.macroArgs,
        originalPrompt: resolved.originalPrompt,
        resolvedPrompt: resolved.resolvedPrompt,
        attachmentAssetIds: input.attachmentAssetIds ?? [],
        confidenceRationale: output.confidenceRationale ?? plan.confidenceRationale,
        diffGroups,
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
        confidence: session.confidence,
        plannerPack: resolved.plannerPack,
        macroId: resolved.macroId
      }
    }
  });

  return {
    sessionId: session.id,
    planId: plan.planJob.id,
    planRevisionHash: session.planRevisionHash,
    safetyMode: session.safetyMode,
    confidence: session.confidence,
    plannerPack: resolved.plannerPack,
    macroId: resolved.macroId,
    macroLabel: resolved.macroLabel,
    confidenceRationale: output.confidenceRationale ?? plan.confidenceRationale,
    diffGroups,
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
  if (session.planRevisionHash !== params.planRevisionHash) {
    throw new Error("Autopilot plan revision hash mismatch");
  }
  if (session.safetyMode === "SUGGESTIONS_ONLY") {
    return {
      sessionId: session.id,
      applied: false,
      suggestionsOnly: true,
      issues: [
        {
          code: "AUTOPILOT_PREVIEW_ONLY",
          message: "Autopilot session is in suggestions-only mode.",
          severity: "WARN" as const
        }
      ],
      revisionId: null as string | null,
      undoToken: null as string | null,
      selectedOperationCount: 0,
      totalOperationCount: 0
    };
  }
  const metadata = (session.metadata && typeof session.metadata === "object")
    ? (session.metadata as Record<string, unknown>)
    : {};
  const diffGroups = Array.isArray(metadata.diffGroups) ? (metadata.diffGroups as AutopilotDiffGroup[]) : [];
  const timelineItemIds = getTimelineOperationItemIds(diffGroups);
  if (session.safetyMode === "APPLY_WITH_CONFIRM" && timelineItemIds.length > 0) {
    if (!params.operationDecisions || params.operationDecisions.length === 0) {
      throw new Error("Apply-with-confirm requires explicit operation decisions.");
    }
    const decidedItemIds = new Set(params.operationDecisions.map((decision) => decision.itemId));
    const missing = timelineItemIds.filter((id) => !decidedItemIds.has(id));
    if (missing.length > 0) {
      throw new Error(`Explicit decisions missing for ${missing.length} timeline item(s).`);
    }
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
          ...metadata,
          lastApplyResult: result,
          lastOperationDecisions: params.operationDecisions ?? null
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
        payload: {
          ...result,
          operationDecisions: params.operationDecisions ?? []
        },
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
  if (params.sessionId) {
    const session = await prisma.autopilotSession.findFirst({
      where: {
        id: params.sessionId,
        workspaceId: ctx.workspace.id,
        projectId: ctx.projectV2.id
      }
    });
    if (!session) {
      throw new Error("Autopilot session not found");
    }
  }
  let result: Awaited<ReturnType<typeof undoChatPlanApplyWithMode>>;
  try {
    result = await undoChatPlanApplyWithMode(ctx.projectV2.id, params.undoToken, Boolean(params.force));
  } catch (error) {
    if (params.sessionId) {
      await prisma.autopilotAction.create({
        data: {
          workspaceId: ctx.workspace.id,
          projectId: ctx.projectV2.id,
          sessionId: params.sessionId,
          actionType: "UNDO",
          status: "FAILED",
          payload: {
            undoToken: params.undoToken,
            force: Boolean(params.force)
          },
          errorMessage: error instanceof Error ? error.message : "Undo failed"
        }
      });
    }
    throw error;
  }

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

export async function replayAutopilotSession(params: {
  projectIdOrV2Id: string;
  sessionId: string;
  applyImmediately?: boolean;
  reuseOperationDecisions?: boolean;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const sourceSession = await prisma.autopilotSession.findFirst({
    where: {
      id: params.sessionId,
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id
    }
  });
  if (!sourceSession) {
    throw new Error("Autopilot session not found");
  }
  const metadata = (sourceSession.metadata && typeof sourceSession.metadata === "object")
    ? (sourceSession.metadata as Record<string, unknown>)
    : {};
  const plan = await createAutopilotPlan(ctx.projectV2.id, {
    prompt: typeof metadata.originalPrompt === "string" ? metadata.originalPrompt : sourceSession.prompt,
    plannerPack: typeof metadata.plannerPack === "string" ? metadata.plannerPack as z.infer<typeof AutopilotPlannerPackSchema> : undefined,
    macroId: typeof metadata.macroId === "string" ? metadata.macroId as z.infer<typeof AutopilotMacroIdSchema> : undefined,
    macroArgs: typeof metadata.macroArgs === "object" && metadata.macroArgs !== null ? metadata.macroArgs as z.infer<typeof AutopilotMacroArgsSchema> : undefined,
    attachmentAssetIds: Array.isArray(metadata.attachmentAssetIds)
      ? metadata.attachmentAssetIds.filter((entry): entry is string => typeof entry === "string")
      : []
  });

  const shouldApply = params.applyImmediately !== false;
  if (!shouldApply) {
    return {
      replayedFromSessionId: sourceSession.id,
      newSessionId: plan.sessionId,
      applied: false,
      requiresExplicitDecisions: false,
      plan
    };
  }

  let operationDecisions: ChatPlanOperationDecision[] | undefined;
  if (params.reuseOperationDecisions !== false) {
    const lastApply = await prisma.autopilotAction.findFirst({
      where: {
        workspaceId: ctx.workspace.id,
        projectId: ctx.projectV2.id,
        sessionId: sourceSession.id,
        actionType: "APPLY"
      },
      orderBy: {
        createdAt: "desc"
      }
    });
    if (lastApply?.payload && typeof lastApply.payload === "object") {
      const payload = lastApply.payload as Record<string, unknown>;
      const rawDecisions = Array.isArray(payload.operationDecisions) ? payload.operationDecisions : [];
      operationDecisions = rawDecisions
        .filter((entry): entry is { itemId: string; accepted: boolean } => (
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as Record<string, unknown>).itemId === "string" &&
          typeof (entry as Record<string, unknown>).accepted === "boolean"
        ))
        .map((entry) => ({
          itemId: entry.itemId,
          accepted: entry.accepted
        }));
    }
  }
  if (plan.safetyMode === "APPLY_WITH_CONFIRM" && (!operationDecisions || operationDecisions.length === 0)) {
    return {
      replayedFromSessionId: sourceSession.id,
      newSessionId: plan.sessionId,
      applied: false,
      requiresExplicitDecisions: true,
      plan
    };
  }

  const applyResult = await applyAutopilotPlan({
    projectIdOrV2Id: ctx.projectV2.id,
    sessionId: plan.sessionId,
    planRevisionHash: plan.planRevisionHash,
    operationDecisions
  });

  return {
    replayedFromSessionId: sourceSession.id,
    newSessionId: plan.sessionId,
    applied: applyResult.applied,
    requiresExplicitDecisions: false,
    plan,
    applyResult
  };
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
