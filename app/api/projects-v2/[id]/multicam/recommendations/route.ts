import { requireProjectContext } from "@/lib/api-context";
import { buildMulticamRecommendations } from "@/lib/ai/phase2";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await requireProjectContext(params.id);
    const safeLimit = (() => {
      const raw = Number(new URL(_request.url).searchParams.get("limit") ?? "8");
      if (!Number.isFinite(raw)) {
        return 8;
      }
      return Math.max(1, Math.min(Math.floor(raw), 20));
    })();
    const segments = await prisma.transcriptSegment.findMany({
      where: {
        projectId: ctx.projectV2.id
      },
      orderBy: {
        startMs: "asc"
      },
      take: 240
    });

    const recommendations = buildMulticamRecommendations({
      segments: segments.map((segment) => ({
        id: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        speakerLabel: segment.speakerLabel,
        confidenceAvg: segment.confidenceAvg
      })),
      maxRecommendations: safeLimit
    });

    return jsonOk({
      projectV2Id: ctx.projectV2.id,
      recommendationCount: recommendations.length,
      recommendations,
      autoSwitchSuggestions: recommendations.map((recommendation) => recommendation.autoSwitchSuggestion)
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
