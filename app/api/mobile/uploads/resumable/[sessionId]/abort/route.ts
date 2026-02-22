import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
import { requireResumableUploadSessionForUser, updateResumableUploadSessionStatus } from "@/lib/mobile/resumable";
import { abortMultipartUpload } from "@/lib/storage";

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

    const session = await requireResumableUploadSessionForUser(params.sessionId, user.id, {
      allowTerminal: true
    });

    if (session.status === "COMPLETED") {
      return NextResponse.json({ error: "Cannot abort a completed upload session" }, { status: 400 });
    }

    if (session.status === "ACTIVE") {
      await abortMultipartUpload({
        storageKey: session.storageKey,
        uploadId: session.uploadId
      });
    }

    const aborted = await updateResumableUploadSessionStatus(session.id, "ABORTED", {
      completedAt: null
    });

    return NextResponse.json({
      session: {
        id: aborted.id,
        status: aborted.status,
        updatedAt: aborted.updatedAt
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
