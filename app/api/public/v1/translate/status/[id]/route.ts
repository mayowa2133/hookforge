import { authenticatePublicApiKey } from "@/lib/public-api";
import { prisma } from "@/lib/prisma";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";

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
        results: aiJob.results
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
