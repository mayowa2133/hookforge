import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
import {
  buildResumableProgress,
  listResumableUploadedParts,
  markResumablePartUploaded,
  requireResumableUploadSessionForUser,
  ResumablePartCompleteSchema
} from "@/lib/mobile/resumable";

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

    const body = ResumablePartCompleteSchema.parse(await request.json());
    const session = await requireResumableUploadSessionForUser(params.sessionId, user.id);

    if (body.partNumber > session.totalParts) {
      return NextResponse.json({ error: `partNumber must be <= ${session.totalParts}` }, { status: 400 });
    }

    await markResumablePartUploaded(session.id, body.partNumber, body.eTag);
    const parts = await listResumableUploadedParts(session.id);
    const progress = buildResumableProgress(
      session.totalParts,
      parts.map((part) => part.partNumber)
    );

    return NextResponse.json({
      sessionId: session.id,
      partNumber: body.partNumber,
      progress
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
