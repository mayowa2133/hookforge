import { requireProjectContext } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: { id: string; runId: string };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await requireProjectContext(params.id);
    const run = await prisma.audioEnhancementRun.findFirst({
      where: {
        id: params.runId,
        workspaceId: ctx.workspace.id,
        projectId: ctx.projectV2.id
      }
    });
    if (!run) {
      throw new Error("Audio run not found");
    }
    const candidates = await prisma.fillerCandidate.findMany({
      where: {
        runId: run.id
      },
      orderBy: {
        startMs: "asc"
      },
      take: 400
    });
    return jsonOk({
      run: {
        id: run.id,
        mode: run.mode,
        operation: run.operation,
        preset: run.preset,
        status: run.status,
        config: run.config,
        summary: run.summary,
        undoToken: run.undoToken,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString()
      },
      fillerCandidates: candidates.map((candidate) => ({
        id: candidate.id,
        language: candidate.language,
        text: candidate.text,
        startMs: candidate.startMs,
        endMs: candidate.endMs,
        confidence: candidate.confidence,
        status: candidate.status
      }))
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
