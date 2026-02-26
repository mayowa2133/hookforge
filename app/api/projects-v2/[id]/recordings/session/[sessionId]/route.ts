import { NextResponse } from "next/server";
import { routeErrorToResponse } from "@/lib/http";
import { requireProjectContext } from "@/lib/api-context";
import { getRecordingSession, listRecordingChunks, summarizeRecordingProgress } from "@/lib/recordings/session";

export const runtime = "nodejs";

type Context = {
  params: { id: string; sessionId: string };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await requireProjectContext(params.id);
    const session = await getRecordingSession(params.sessionId);
    if (!session || session.projectId !== ctx.projectV2.id || session.userId !== ctx.user.id) {
      return NextResponse.json({ error: "Recording session not found" }, { status: 404 });
    }
    const chunks = await listRecordingChunks(session.id);
    const progress = summarizeRecordingProgress(session.totalParts, chunks);

    return NextResponse.json({
      session: {
        id: session.id,
        mode: session.mode,
        status: session.status,
        fileName: session.fileName,
        mimeType: session.mimeType,
        sizeBytes: session.sizeBytes,
        totalParts: session.totalParts,
        partSizeBytes: session.partSizeBytes,
        autoTranscribe: session.autoTranscribe,
        language: session.language,
        finalizedAssetId: session.finalizedAssetId,
        finalizeAiJobId: session.finalizeAiJobId,
        failedReason: session.failedReason,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        completedAt: session.completedAt
      },
      progress,
      chunks
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
