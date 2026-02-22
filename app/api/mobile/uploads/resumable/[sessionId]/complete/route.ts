import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { registerProjectAssetForUser } from "@/lib/assets/register";
import { routeErrorToResponse } from "@/lib/http";
import {
  buildResumableProgress,
  listResumableUploadedParts,
  requireResumableUploadSessionForUser,
  updateResumableUploadSessionStatus
} from "@/lib/mobile/resumable";
import { completeMultipartUpload } from "@/lib/storage";

export const runtime = "nodejs";

type Context = {
  params: {
    sessionId: string;
  };
};

export async function POST(_request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await requireResumableUploadSessionForUser(params.sessionId, user.id);
    const uploadedParts = await listResumableUploadedParts(session.id);
    const progress = buildResumableProgress(
      session.totalParts,
      uploadedParts.map((part) => part.partNumber)
    );

    if (progress.missingPartNumbers.length > 0) {
      return NextResponse.json(
        {
          error: "Cannot complete upload while parts are missing",
          missingPartNumbers: progress.missingPartNumbers
        },
        { status: 400 }
      );
    }

    await completeMultipartUpload({
      storageKey: session.storageKey,
      uploadId: session.uploadId,
      parts: uploadedParts
    });

    const registered = await registerProjectAssetForUser({
      userId: user.id,
      projectId: session.projectId,
      input: {
        slotKey: session.slotKey,
        storageKey: session.storageKey,
        mimeType: session.mimeType
      }
    });

    const completedSession = await updateResumableUploadSessionStatus(session.id, "COMPLETED");

    return NextResponse.json({
      session: {
        id: completedSession.id,
        status: completedSession.status,
        completedAt: completedSession.completedAt
      },
      progress,
      registration: registered
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
