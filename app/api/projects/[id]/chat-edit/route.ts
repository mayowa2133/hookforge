import { randomUUID } from "crypto";
import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { runChatEditPlannerValidatorExecutor } from "@/lib/ai/chat-edit-pipeline";
import { pushChatUndoEntry } from "@/lib/ai/phase2";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { appendTimelineRevision } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { TIMELINE_STATE_KEY, buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const ChatEditSchema = z.object({
  prompt: z.string().min(4).max(1000),
  attachmentAssetIds: z.array(z.string().min(1)).max(20).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = ChatEditSchema.parse(await request.json());
    const ctx = await requireProjectContext(params.id);

    const legacyProject = await prisma.project.findUnique({
      where: { id: ctx.legacyProject.id },
      select: {
        id: true,
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

    const timelineState = buildTimelineState(
      legacyProject.config,
      legacyProject.assets as Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }>
    );

    const execution = runChatEditPlannerValidatorExecutor({
      prompt: body.prompt,
      state: timelineState
    });
    const nextTimelineState = execution.executionMode === "APPLIED" ? execution.nextState : null;
    const shouldApply = execution.executionMode === "APPLIED" && nextTimelineState !== null;

    let nextConfig = typeof legacyProject.config === "object" && legacyProject.config !== null
      ? (legacyProject.config as Record<string, unknown>)
      : {};

    const previousTimelineJson =
      typeof nextConfig[TIMELINE_STATE_KEY] === "string"
        ? (nextConfig[TIMELINE_STATE_KEY] as string)
        : JSON.stringify(timelineState);

    let undoToken: string | null = null;
    let revision: { id: string } | null = null;

    if (shouldApply) {
      undoToken = randomUUID();
      nextConfig = serializeTimelineState(nextConfig, nextTimelineState);
      nextConfig = pushChatUndoEntry({
        config: nextConfig,
        undoToken,
        timelineStateJson: previousTimelineJson,
        prompt: body.prompt,
        projectId: legacyProject.id,
        lineage: {
          projectId: legacyProject.id,
          baseRevision: timelineState.version,
          baseTimelineHash: timelineState.revisions[0]?.timelineHash,
          appliedRevision: execution.nextRevision ?? undefined,
          appliedTimelineHash: execution.nextTimelineHash ?? undefined
        }
      });

      await prisma.project.update({
        where: { id: legacyProject.id },
        data: {
          config: nextConfig as never
        }
      });

      revision = await appendTimelineRevision({
        projectId: ctx.projectV2.id,
        createdByUserId: ctx.user.id,
        operations: {
          prompt: body.prompt,
          plannedOperations: execution.plannedOperations,
          validatedOperations: execution.validatedOperations,
          appliedTimelineOperations: execution.appliedTimelineOperations,
          planValidation: execution.planValidation,
          invariantIssues: execution.invariantIssues,
          executionMode: execution.executionMode
        }
      });
    }

    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "CHAT_EDIT",
      queueName: queueNameForJobType("CHAT_EDIT"),
      input: {
        prompt: body.prompt,
        attachmentAssetIds: body.attachmentAssetIds ?? [],
        executionMode: execution.executionMode,
        plannedOperations: execution.plannedOperations,
        validatedOperations: execution.validatedOperations,
        planValidation: execution.planValidation,
        appliedTimelineOperations: execution.appliedTimelineOperations,
        constrainedSuggestions: execution.constrainedSuggestions,
        invariantIssues: execution.invariantIssues,
        fallbackReason: execution.fallbackReason,
        undoToken
      }
    });

    return jsonOk({
      executionMode: execution.executionMode,
      plannedOperations: execution.plannedOperations,
      validatedOperations: execution.validatedOperations,
      appliedTimelineOperations: execution.appliedTimelineOperations,
      planValidation: execution.planValidation,
      constrainedSuggestions: execution.constrainedSuggestions,
      fallbackReason: execution.fallbackReason,
      invariantIssues: execution.invariantIssues,
      appliedRevisionId: revision?.id ?? null,
      undoToken,
      aiJobId: aiJob.id
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
