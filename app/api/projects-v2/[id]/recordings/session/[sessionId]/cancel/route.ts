import { NextResponse } from "next/server";
import { routeErrorToResponse } from "@/lib/http";
import { requireProjectContext } from "@/lib/api-context";
import {
  cancelRecordingSessionUpload,
  requireRecordingSessionForUser,
  updateRecordingSessionStatus
} from "@/lib/recordings/session";

export const runtime = "nodejs";

type Context = {
  params: { id: string; sessionId: string };
};

export async function POST(_request: Request, { params }: Context) {
  try {
    const ctx = await requireProjectContext(params.id);
    const session = await requireRecordingSessionForUser(params.sessionId, ctx.user.id, true);
    if (session.projectId !== ctx.projectV2.id) {
      return NextResponse.json({ error: "Recording session not found" }, { status: 404 });
    }
    if (session.status === "COMPLETED" || session.status === "CANCELED") {
      return NextResponse.json({
        canceled: session.status === "CANCELED",
        status: session.status
      });
    }
    await cancelRecordingSessionUpload(session.id);
    const updated = await updateRecordingSessionStatus({
      sessionId: session.id,
      status: "CANCELED",
      completedAt: new Date().toISOString()
    });
    return NextResponse.json({
      canceled: true,
      status: updated.status
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
