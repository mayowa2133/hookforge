import { authenticatePublicApiKey } from "@/lib/public-api";
import { prisma } from "@/lib/prisma";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { getDownloadPresignedUrl } from "@/lib/storage";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const apiKey = await authenticatePublicApiKey(request);

    const aiJob = await prisma.aIJob.findFirst({
      where: {
        id: params.id,
        workspaceId: apiKey.workspaceId,
        OR: [{ type: "DUBBING" }, { type: "LIPSYNC" }, { type: "CAPTION_TRANSLATE" }]
      },
      include: {
        results: true,
        providerRuns: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    if (!aiJob) {
      return jsonError("Job not found", 404);
    }

    const artifacts = await Promise.all(
      aiJob.results
        .filter((result) => Boolean(result.outputStorageKey))
        .map(async (result) => {
          const output = typeof result.output === "object" && result.output !== null ? (result.output as Record<string, unknown>) : {};
          const storageKey = result.outputStorageKey as string;
          return {
            id: result.id,
            kind: result.kind,
            storageKey,
            outputUrl: await getDownloadPresignedUrl(storageKey),
            language: typeof output.language === "string" ? output.language : null,
            sourceLanguage: typeof output.sourceLanguage === "string" ? output.sourceLanguage : null,
            mimeType: typeof output.mimeType === "string" ? output.mimeType : null,
            durationSec: typeof output.durationSec === "number" ? output.durationSec : null,
            quality: typeof output.quality === "object" && output.quality !== null ? output.quality : null,
            translationProfile:
              typeof output.translationProfile === "object" && output.translationProfile !== null
                ? output.translationProfile
                : null
          };
        })
    );

    const outputRecord = typeof aiJob.output === "object" && aiJob.output !== null ? (aiJob.output as Record<string, unknown>) : {};
    const sideEffects = typeof outputRecord.sideEffects === "object" && outputRecord.sideEffects !== null
      ? (outputRecord.sideEffects as Record<string, unknown>)
      : {};
    const phase5Summary =
      typeof sideEffects.phase5 === "object" && sideEffects.phase5 !== null
        ? (sideEffects.phase5 as Record<string, unknown>).qualitySummary ?? null
        : null;

    return jsonOk({
      job: {
        id: aiJob.id,
        type: aiJob.type,
        status: aiJob.status,
        progress: aiJob.progress,
        output: aiJob.output,
        errorMessage: aiJob.errorMessage,
        createdAt: aiJob.createdAt,
        updatedAt: aiJob.updatedAt,
        latestProviderRun: aiJob.providerRuns[0] ?? null,
        results: aiJob.results,
        artifacts,
        qualitySummary: phase5Summary
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
