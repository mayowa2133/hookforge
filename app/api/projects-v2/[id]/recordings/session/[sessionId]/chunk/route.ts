import { NextResponse } from "next/server";
import { routeErrorToResponse } from "@/lib/http";
import { requireProjectContext } from "@/lib/api-context";
import {
  getRecordingChunkUploadUrl,
  listRecordingChunks,
  RecordingChunkUpsertSchema,
  requireRecordingSessionForUser,
  summarizeRecordingProgress,
  upsertRecordingChunk
} from "@/lib/recordings/session";

export const runtime = "nodejs";

type Context = {
  params: { id: string; sessionId: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await requireProjectContext(params.id);
    const body = RecordingChunkUpsertSchema.parse(await request.json());
    const session = await requireRecordingSessionForUser(params.sessionId, ctx.user.id);
    if (session.projectId !== ctx.projectV2.id) {
      return NextResponse.json({ error: "Recording session not found" }, { status: 404 });
    }
    if (body.partNumber > session.totalParts) {
      return NextResponse.json({ error: "partNumber exceeds total parts" }, { status: 400 });
    }

    if (!body.eTag) {
      const uploadUrl = await getRecordingChunkUploadUrl(session.id, body.partNumber);
      return NextResponse.json({
        mode: "UPLOAD_URL",
        partNumber: body.partNumber,
        uploadUrl,
        method: "PUT"
      });
    }

    await upsertRecordingChunk({
      sessionId: session.id,
      partNumber: body.partNumber,
      eTag: body.eTag,
      checksumSha256: body.checksumSha256
    });
    const chunks = await listRecordingChunks(session.id);
    const progress = summarizeRecordingProgress(session.totalParts, chunks);
    return NextResponse.json({
      mode: "CHUNK_CONFIRMED",
      partNumber: body.partNumber,
      progress
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
