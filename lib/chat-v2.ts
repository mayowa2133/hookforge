import { createHash, randomUUID } from "crypto";
import { type AIJob, type AIJobStatus } from "@prisma/client";
import { requireProjectContext } from "@/lib/api-context";
import { runChatEditPlannerValidatorExecutor, type ChatEditPipelineResult } from "@/lib/ai/chat-edit-pipeline";
import { consumeChatUndoEntryWithLineage, pushChatUndoEntry } from "@/lib/ai/phase2";
import { appendTimelineRevision } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { previewTimelineOperationsWithValidation } from "@/lib/timeline-invariants";
import { TIMELINE_STATE_KEY, buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";
import type { TimelineOperation } from "@/lib/timeline-types";

export type ChatPlanDiffItem = {
  id: string;
  type: "operation" | "note";
  label: string;
  before?: string;
  after?: string;
  severity?: "INFO" | "WARN" | "ERROR";
};

export type ChatPlanDiffGroup = {
  group: "timeline" | "transcript" | "captions";
  title: string;
  summary: string;
  items: ChatPlanDiffItem[];
};

type PlanPayload = {
  kind: "chat_plan_v2";
  execution: ChatEditPipelineResult;
  createdAt: string;
  planRevisionHash: string;
  diffGroups: ChatPlanDiffGroup[];
  appliedRevisionId?: string | null;
  undoToken?: string | null;
};

function hashPlanRevision(params: {
  prompt: string;
  execution: ChatEditPipelineResult;
}) {
  const payload = JSON.stringify({
    prompt: params.prompt,
    executionMode: params.execution.executionMode,
    plannedOperations: params.execution.plannedOperations,
    validatedOperations: params.execution.validatedOperations,
    appliedTimelineOperations: params.execution.appliedTimelineOperations,
    constrainedSuggestions: params.execution.constrainedSuggestions,
    fallbackReason: params.execution.fallbackReason
  });
  return createHash("sha256").update(payload).digest("hex");
}

function toTitleCase(input: string) {
  return input
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function buildDiffGroups(execution: ChatEditPipelineResult): ChatPlanDiffGroup[] {
  const timelineItems: ChatPlanDiffItem[] = execution.appliedTimelineOperations.map((operation, index) => ({
    id: `timeline-op-${index + 1}`,
    type: "operation",
    label: `${index + 1}. ${toTitleCase(operation.op)}`,
    after: JSON.stringify(operation)
  }));

  const captionItems: ChatPlanDiffItem[] = execution.validatedOperations
    .filter((operation) => operation.op === "caption_style")
    .map((operation, index) => ({
      id: `caption-op-${index + 1}`,
      type: "operation",
      label: `${index + 1}. Caption Style`,
      after: JSON.stringify(operation)
    }));

  const transcriptItems: ChatPlanDiffItem[] = execution.constrainedSuggestions.map((suggestion, index) => ({
    id: `transcript-note-${index + 1}`,
    type: "note",
    label: `${suggestion.title}: ${suggestion.reason}`,
    after: suggestion.prompt,
    severity: "INFO"
  }));

  return [
    {
      group: "timeline",
      title: "Timeline Changes",
      summary: timelineItems.length > 0 ? `${timelineItems.length} operation(s) planned` : "No timeline mutation planned",
      items: timelineItems
    },
    {
      group: "transcript",
      title: "Transcript Notes",
      summary: transcriptItems.length > 0 ? `${transcriptItems.length} suggestion(s)` : "No transcript note generated",
      items: transcriptItems
    },
    {
      group: "captions",
      title: "Caption Changes",
      summary: captionItems.length > 0 ? `${captionItems.length} caption operation(s)` : "No caption operation planned",
      items: captionItems
    }
  ];
}

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
  const planRevisionHash = hashPlanRevision({
    prompt,
    execution
  });
  const diffGroups = buildDiffGroups(execution);

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
        planRevisionHash,
        diffGroups,
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
  if (!payload.planRevisionHash) {
    throw new Error("Plan hash missing");
  }
  return applyChatPlanWithHash(projectIdOrV2Id, planId, payload.planRevisionHash);
}

export async function applyChatPlanWithHash(projectIdOrV2Id: string, planId: string, expectedPlanRevisionHash: string) {
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
  if (payload.planRevisionHash !== expectedPlanRevisionHash) {
    throw new Error("Plan revision hash mismatch");
  }

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
  return undoChatPlanApplyWithMode(projectIdOrV2Id, undoToken, false);
}

export async function undoChatPlanApplyWithMode(projectIdOrV2Id: string, undoToken: string, force = false) {
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
    requireLatestLineage: !force
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
