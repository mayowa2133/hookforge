import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
import {
  buildResumableProgress,
  listResumableUploadedParts,
  requireResumableUploadSessionForUser
} from "@/lib/mobile/resumable";

export const runtime = "nodejs";

type Context = {
  params: {
    sessionId: string;
  };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await requireResumableUploadSessionForUser(params.sessionId, user.id, {
      allowTerminal: true
    });
    const parts = await listResumableUploadedParts(session.id);
    const progress = buildResumableProgress(
      session.totalParts,
      parts.map((part) => part.partNumber)
    );

    return NextResponse.json({
      session: {
        id: session.id,
        projectId: session.projectId,
        slotKey: session.slotKey,
        storageKey: session.storageKey,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        completedAt: session.completedAt
      },
      progress
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
