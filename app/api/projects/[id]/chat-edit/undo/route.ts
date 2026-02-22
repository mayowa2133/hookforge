import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { consumeChatUndoEntryWithLineage } from "@/lib/ai/phase2";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { appendTimelineRevision } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { TIMELINE_STATE_KEY, buildTimelineState } from "@/lib/timeline-legacy";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const UndoSchema = z.object({
  undoToken: z.string().min(8)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = UndoSchema.parse(await request.json());
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

    const currentTimeline = buildTimelineState(
      legacyProject.config,
      legacyProject.assets as Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }>
    );

    const consumed = consumeChatUndoEntryWithLineage({
      configInput: legacyProject.config,
      undoToken: body.undoToken,
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

    const restoredTimeline = buildTimelineState(
      nextConfig,
      legacyProject.assets as Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }>
    );

    const revision = await appendTimelineRevision({
      projectId: ctx.projectV2.id,
      createdByUserId: ctx.user.id,
      operations: {
        undoToken: body.undoToken,
        restoredAt: new Date().toISOString(),
        prompt: consumed.entry.prompt,
        lineageValidated: true
      }
    });

    return jsonOk({
      restored: true,
      appliedRevisionId: revision.id,
      timeline: restoredTimeline
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
