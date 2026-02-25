import { randomUUID } from "crypto";
import { type AIJob, type AIJobStatus } from "@prisma/client";
import { requireProjectContext } from "@/lib/api-context";
import { runChatEditPlannerValidatorExecutor, type ChatEditPipelineResult } from "@/lib/ai/chat-edit-pipeline";
import { consumeChatUndoEntryWithLineage, pushChatUndoEntry } from "@/lib/ai/phase2";
import { appendTimelineRevision } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { previewTimelineOperationsWithValidation } from "@/lib/timeline-invariants";
import { TIMELINE_STATE_KEY, buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";
import type { TimelineOperation } from "@/lib/timeline-types";

type PlanPayload = {
  kind: "chat_plan_v2";
  execution: ChatEditPipelineResult;
  createdAt: string;
  appliedRevisionId?: string | null;
  undoToken?: string | null;
};

function asTimelineOperations(input: unknown): TimelineOperation[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((entry) => entry && typeof entry === "object" && "op" in (entry as Record<string, unknown>))
    .map((entry) => entry as TimelineOperation);
}

async function loadLegacyProjectState(projectIdOrV2Id: string) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const legacyProject = await prisma.project.findUnique({
    where: { id: ctx.legacyProject.id },
    select: {
      id: true,
      userId: true,
      config: true,
      assets: {
        select: {
          id: true,
          slotKey: true,
          kind: true,
          durationSec: true
        }
      }
    }
  });

  if (!legacyProject) {
    throw new Error("Project not found");
  }

  const state = buildTimelineState(
    legacyProject.config,
    legacyProject.assets as Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }>
  );

  return {
    ctx,
    legacyProject,
    state
  };
}

export async function createChatPlan(projectIdOrV2Id: string, prompt: string, attachmentAssetIds: string[] = []) {
  const { ctx, state } = await loadLegacyProjectState(projectIdOrV2Id);
  const execution = runChatEditPlannerValidatorExecutor({
    prompt,
    state
  });

  const planJob = await prisma.aIJob.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "CHAT_EDIT",
      status: "DONE" as AIJobStatus,
      progress: 100,
      input: {
        mode: "plan",
        prompt,
        attachmentAssetIds
      },
      output: {
        kind: "chat_plan_v2",
        execution,
        createdAt: new Date().toISOString()
      } as never
    }
  });

  return {
    planJob,
    execution
  };
}

function parsePlanPayload(job: AIJob): PlanPayload {
  const output = job.output;
  if (!output || typeof output !== "object") {
    throw new Error("Plan not found");
  }
  const payload = output as Partial<PlanPayload>;
  if (payload.kind !== "chat_plan_v2" || !payload.execution) {
    throw new Error("Plan not found");
  }
  return payload as PlanPayload;
}

export async function applyChatPlan(projectIdOrV2Id: string, planId: string) {
  const { ctx, legacyProject, state } = await loadLegacyProjectState(projectIdOrV2Id);
  const planJob = await prisma.aIJob.findFirst({
    where: {
      id: planId,
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "CHAT_EDIT"
    }
  });

  if (!planJob) {
    throw new Error("Plan not found");
  }

  const payload = parsePlanPayload(planJob);
  if (payload.execution.executionMode !== "APPLIED") {
    return {
      applied: false,
      suggestionsOnly: true,
      issues: payload.execution.invariantIssues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        severity: "ERROR" as const
      })),
      revisionId: null as string | null,
      undoToken: null as string | null
    };
  }

  const operations = asTimelineOperations(payload.execution.appliedTimelineOperations);
  const preview = previewTimelineOperationsWithValidation({
    state,
    operations
  });

  if (!preview.valid || !preview.nextState) {
    return {
      applied: false,
      suggestionsOnly: true,
      issues: preview.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        severity: "ERROR" as const
      })),
      revisionId: null as string | null,
      undoToken: null as string | null
    };
  }

  const undoToken = randomUUID();
  const baseConfig = typeof legacyProject.config === "object" && legacyProject.config !== null
    ? (legacyProject.config as Record<string, unknown>)
    : {};
  const previousTimelineJson = typeof baseConfig[TIMELINE_STATE_KEY] === "string"
    ? (baseConfig[TIMELINE_STATE_KEY] as string)
    : JSON.stringify(state);
  const nextConfig = serializeTimelineState(baseConfig, preview.nextState);
  const configWithUndo = pushChatUndoEntry({
    config: nextConfig,
    undoToken,
    timelineStateJson: previousTimelineJson,
    prompt: String((planJob.input as Record<string, unknown>)?.prompt ?? "chat plan apply"),
    projectId: legacyProject.id,
    lineage: {
      projectId: legacyProject.id,
      baseRevision: state.version,
      baseTimelineHash: state.revisions[0]?.timelineHash,
      appliedRevision: preview.revision ?? undefined,
      appliedTimelineHash: preview.timelineHash ?? undefined
    }
  });

  await prisma.project.update({
    where: { id: legacyProject.id },
    data: {
      config: configWithUndo as never
    }
  });

  const revision = await appendTimelineRevision({
    projectId: ctx.projectV2.id,
    createdByUserId: ctx.user.id,
    operations: {
      source: "chat_plan_apply_v2",
      planId,
      operations
    }
  });

  await prisma.aIJob.update({
    where: { id: planJob.id },
    data: {
      output: {
        ...payload,
        appliedRevisionId: revision.id,
        undoToken
      } as never
    }
  });

  return {
    applied: true,
    suggestionsOnly: false,
    issues: [],
    revisionId: revision.id,
    undoToken
  };
}

export async function undoChatPlanApply(projectIdOrV2Id: string, undoToken: string) {
  const { ctx, legacyProject } = await loadLegacyProjectState(projectIdOrV2Id);

  const currentTimeline = buildTimelineState(
    legacyProject.config,
    legacyProject.assets as Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }>
  );
  const consumed = consumeChatUndoEntryWithLineage({
    configInput: legacyProject.config,
    undoToken,
    projectId: legacyProject.id,
    currentRevision: currentTimeline.version,
    currentTimelineHash: currentTimeline.revisions[0]?.timelineHash ?? null,
    requireLatestLineage: true
  });
  if ("error" in consumed) {
    throw new Error(consumed.error);
  }

  const nextConfig = {
    ...consumed.config,
    [TIMELINE_STATE_KEY]: consumed.entry.timelineStateJson
  };

  await prisma.project.update({
    where: { id: legacyProject.id },
    data: {
      config: nextConfig as never
    }
  });

  const revision = await appendTimelineRevision({
    projectId: ctx.projectV2.id,
    createdByUserId: ctx.user.id,
    operations: {
      source: "chat_plan_undo_v2",
      undoToken,
      prompt: consumed.entry.prompt
    }
  });

  return {
    restored: true,
    appliedRevisionId: revision.id
  };
}
