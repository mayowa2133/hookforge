import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import {
  listRecordingChunks,
  requireRecordingSessionForUser,
  summarizeRecordingProgress,
  updateRecordingSessionStatus
} from "@/lib/recordings/session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: { id: string; sessionId: string };
};

const RecoverSchema = z.object({
  mode: z.enum(["resume", "status_only"]).default("resume"),
  reason: z.string().trim().max(240).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = RecoverSchema.parse(await request.json().catch(() => ({})));
    const ctx = await requireProjectContext(params.id);
    const session = await requireRecordingSessionForUser(params.sessionId, ctx.user.id, true);
    if (session.projectId !== ctx.projectV2.id) {
      throw new Error("Recording session not found");
    }

    const chunks = await listRecordingChunks(session.id);
    const progress = summarizeRecordingProgress(session.totalParts, chunks);
    const recoverable = session.status === "FAILED" || session.status === "CANCELED";
    let resumed = false;
    let nextStatus = session.status;

    if (body.mode === "resume" && recoverable) {
      const updated = await updateRecordingSessionStatus({
        sessionId: session.id,
        status: "ACTIVE",
        failedReason: null
      });
      nextStatus = updated.status;
      resumed = true;
    }

    await prisma.recordingRecovery.create({
      data: {
        workspaceId: ctx.workspace.id,
        projectId: ctx.projectV2.id,
        recordingSessionId: session.id,
        status: resumed ? "RESOLVED" : recoverable ? "OPEN" : "FAILED",
        reason: body.reason ?? null,
        createdByUserId: ctx.user.id,
        metadata: {
          mode: body.mode,
          previousStatus: session.status,
          nextStatus,
          completedParts: progress.completedParts,
          totalParts: progress.totalParts
        }
      }
    });

    return jsonOk({
      sessionId: session.id,
      recoverable,
      resumed,
      status: nextStatus,
      progress,
      state: {
        phase: resumed ? "RESUMED" : recoverable ? "RECOVERABLE" : "TERMINAL",
        failedReason: session.failedReason
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
