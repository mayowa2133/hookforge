import { randomUUID } from "crypto";
import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { buildChatEditPlan } from "@/lib/ai/chat-edit";
import { buildTimelineOpsFromChatPlan, pushChatUndoEntry } from "@/lib/ai/phase2";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { appendTimelineRevision } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { TIMELINE_STATE_KEY, applyTimelineOperations, buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";

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

    const plannedOperations = buildChatEditPlan(body.prompt);
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
    const appliedTimelineOperations = buildTimelineOpsFromChatPlan({
      state: timelineState,
      plannedOperations
    });
    const undoToken = randomUUID();

    let nextConfig = typeof legacyProject.config === "object" && legacyProject.config !== null
      ? (legacyProject.config as Record<string, unknown>)
      : {};

    const previousTimelineJson =
      typeof nextConfig[TIMELINE_STATE_KEY] === "string"
        ? (nextConfig[TIMELINE_STATE_KEY] as string)
        : JSON.stringify(timelineState);

    if (appliedTimelineOperations.length > 0) {
      const applied = applyTimelineOperations(timelineState, appliedTimelineOperations);
      nextConfig = serializeTimelineState(nextConfig, applied.state);
    }

    nextConfig = pushChatUndoEntry({
      config: nextConfig,
      undoToken,
      timelineStateJson: previousTimelineJson,
      prompt: body.prompt
    });

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
        prompt: body.prompt,
        plannedOperations,
        appliedTimelineOperations
      }
    });

    const aiJob = await enqueueAIJob({
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      type: "CHAT_EDIT",
      queueName: queueNameForJobType("CHAT_EDIT"),
      input: {
        prompt: body.prompt,
        attachmentAssetIds: body.attachmentAssetIds ?? [],
        plannedOperations,
        appliedTimelineOperations,
        undoToken
      }
    });

    return jsonOk({
      plannedOperations,
      appliedTimelineOperations,
      appliedRevisionId: revision.id,
      undoToken,
      aiJobId: aiJob.id
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
