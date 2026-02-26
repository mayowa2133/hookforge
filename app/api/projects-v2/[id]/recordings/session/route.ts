import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { routeErrorToResponse } from "@/lib/http";
import { requireProjectContext } from "@/lib/api-context";
import {
  createRecordingSession,
  RecordingSessionCreateSchema,
  RECORDING_DEFAULT_PART_SIZE_BYTES,
  RECORDING_MIN_PART_SIZE_BYTES
} from "@/lib/recordings/session";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = RecordingSessionCreateSchema.parse(await request.json());
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (body.sizeBytes > maxBytes) {
      return NextResponse.json({ error: `File exceeds ${env.MAX_UPLOAD_MB}MB upload limit` }, { status: 413 });
    }

    const ctx = await requireProjectContext(params.id);
    const session = await createRecordingSession({
      userId: ctx.user.id,
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      mode: body.mode,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      totalParts: body.totalParts,
      partSizeBytes: body.partSizeBytes,
      autoTranscribe: body.autoTranscribe,
      language: body.language
    });

    return NextResponse.json({
      session: {
        id: session.id,
        projectId: session.projectId,
        mode: session.mode,
        language: session.language,
        autoTranscribe: session.autoTranscribe,
        storageKey: session.storageKey,
        totalParts: session.totalParts,
        partSizeBytes: session.partSizeBytes,
        minPartSizeBytes: RECORDING_MIN_PART_SIZE_BYTES,
        recommendedPartSizeBytes: RECORDING_DEFAULT_PART_SIZE_BYTES,
        status: session.status
      },
      next: {
        chunkEndpoint: `/api/projects-v2/${ctx.projectV2.id}/recordings/session/${session.id}/chunk`,
        statusEndpoint: `/api/projects-v2/${ctx.projectV2.id}/recordings/session/${session.id}`,
        finalizeEndpoint: `/api/projects-v2/${ctx.projectV2.id}/recordings/session/${session.id}/finalize`,
        cancelEndpoint: `/api/projects-v2/${ctx.projectV2.id}/recordings/session/${session.id}/cancel`,
        recoverEndpoint: `/api/projects-v2/${ctx.projectV2.id}/recordings/session/${session.id}/recover`
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
