import { NextResponse } from "next/server";
import { z } from "zod";
import { routeErrorToResponse } from "@/lib/http";
import { requireProjectContext } from "@/lib/api-context";
import {
  completeRecordingSessionMultipart,
  requireRecordingSessionForUser,
  updateRecordingSessionStatus
} from "@/lib/recordings/session";
import { registerProjectV2UploadedMedia } from "@/lib/projects-v2/media-register";
import { enqueueTranscriptAuto } from "@/lib/transcript/service";

export const runtime = "nodejs";

type Context = {
  params: { id: string; sessionId: string };
};

const FinalizeSchema = z.object({
  autoTranscribe: z.boolean().optional(),
  language: z.string().min(2).max(12).optional()
});

function autoTranscriptDefaults(language: string) {
  return {
    language,
    diarization: false,
    punctuationStyle: "auto" as const,
    confidenceThreshold: 0.86,
    reDecodeEnabled: true,
    maxWordsPerSegment: 7,
    maxCharsPerLine: 24,
    maxLinesPerSegment: 2
  };
}

export async function POST(request: Request, { params }: Context) {
  try {
    const body = FinalizeSchema.parse(await request.json().catch(() => ({})));
    const ctx = await requireProjectContext(params.id);
    const session = await requireRecordingSessionForUser(params.sessionId, ctx.user.id, true);

    if (session.projectId !== ctx.projectV2.id) {
      return NextResponse.json({ error: "Recording session not found" }, { status: 404 });
    }
    if (session.status === "COMPLETED") {
      return NextResponse.json({
        finalized: true,
        status: session.status,
        finalizedAssetId: session.finalizedAssetId,
        aiJobId: session.finalizeAiJobId
      });
    }
    if (session.status === "CANCELED") {
      return NextResponse.json({ error: "Recording session already canceled" }, { status: 400 });
    }

    await updateRecordingSessionStatus({
      sessionId: session.id,
      status: "FINALIZING"
    });

    try {
      await completeRecordingSessionMultipart(session.id);
      const registered = await registerProjectV2UploadedMedia({
        projectIdOrV2Id: ctx.projectV2.id,
        storageKey: session.storageKey,
        mimeType: session.mimeType,
        originalFileName: session.fileName,
        sourceTag: "recording_finalize_v2"
      });

      let aiJobId: string | null = null;
      const shouldAutoTranscribe = body.autoTranscribe ?? session.autoTranscribe;
      const normalizedLanguage = (body.language?.trim().toLowerCase() || session.language || "en");
      if (shouldAutoTranscribe && (registered.inferredKind === "VIDEO" || registered.inferredKind === "AUDIO")) {
        const job = await enqueueTranscriptAuto(ctx.projectV2.id, autoTranscriptDefaults(normalizedLanguage));
        aiJobId = job.aiJob.id;
      }

      const updated = await updateRecordingSessionStatus({
        sessionId: session.id,
        status: "COMPLETED",
        finalizedAssetId: registered.mediaAsset.id,
        finalizeAiJobId: aiJobId
      });

      return NextResponse.json({
        finalized: true,
        status: updated.status,
        recordingSessionId: updated.id,
        finalizedAssetId: updated.finalizedAssetId,
        aiJobId: updated.finalizeAiJobId,
        media: registered.response
      });
    } catch (error) {
      await updateRecordingSessionStatus({
        sessionId: session.id,
        status: "FAILED",
        failedReason: error instanceof Error ? error.message : "Recording finalization failed"
      });
      throw error;
    }
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
