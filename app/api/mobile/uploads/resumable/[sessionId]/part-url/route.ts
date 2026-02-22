import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
import {
  listResumableUploadedParts,
  requireResumableUploadSessionForUser,
  ResumablePartUrlSchema
} from "@/lib/mobile/resumable";
import { getMultipartPartPresignedUrl } from "@/lib/storage";

export const runtime = "nodejs";

type Context = {
  params: {
    sessionId: string;
  };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = ResumablePartUrlSchema.parse(await request.json());
    const session = await requireResumableUploadSessionForUser(params.sessionId, user.id);

    if (body.partNumber > session.totalParts) {
      return NextResponse.json({ error: `partNumber must be <= ${session.totalParts}` }, { status: 400 });
    }

    const existing = await listResumableUploadedParts(session.id);
    const alreadyUploaded = existing.some((part) => part.partNumber === body.partNumber);

    const uploadUrl = await getMultipartPartPresignedUrl({
      storageKey: session.storageKey,
      uploadId: session.uploadId,
      partNumber: body.partNumber
    });

    return NextResponse.json({
      sessionId: session.id,
      partNumber: body.partNumber,
      alreadyUploaded,
      uploadUrl,
      method: "PUT"
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
