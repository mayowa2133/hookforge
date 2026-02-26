import { z } from "zod";
import { Prisma } from "@prisma/client";
import { buildParityScorecardForWorkspace } from "@/lib/parity/scorecard";
import { prisma } from "@/lib/prisma";

export const DescriptBaselineScoreByModule: Record<string, number> = {
  recording: 76,
  transcript: 80,
  audio: 78,
  autopilot: 65,
  collaboration: 74,
  publishing: 72,
  reliability: 82
};

export const RunParityBenchmarkSchema = z.object({
  modules: z.array(z.string().min(2).max(80)).max(20).optional(),
  passThreshold: z.number().min(0).max(100).default(70)
});

export function summarizeBenchmarkAgainstDescript(params: {
  results: Array<{ module: string; score: number; passed: boolean; tier: string }>;
  passThreshold: number;
}) {
  const withBaseline = params.results.map((result) => {
    const baselineScore = DescriptBaselineScoreByModule[result.module] ?? 70;
    const deltaScore = Number((result.score - baselineScore).toFixed(2));
    return {
      ...result,
      baselineScore,
      deltaScore,
      advantage: deltaScore >= 3
    };
  });

  const parityModules = withBaseline.filter((result) => result.tier === "Descript parity");
  const parityMetCount = parityModules.filter((result) => result.deltaScore >= 0).length;
  const parityMet = parityModules.length > 0 && parityMetCount === parityModules.length;
  const differentiatorModules = withBaseline.filter((result) => result.tier === "Descript+");
  const differentiatorAdvantageCount = differentiatorModules.filter((result) => result.advantage).length;
  const betterThanDescript = parityMet && differentiatorAdvantageCount > 0;

  return {
    parityMet,
    parityMetCount,
    parityTotal: parityModules.length,
    differentiatorAdvantageCount,
    differentiatorTotal: differentiatorModules.length,
    betterThanDescript,
    advantageModules: withBaseline.filter((result) => result.advantage).map((result) => result.module),
    moduleDeltas: withBaseline.map((result) => ({
      module: result.module,
      baselineScore: result.baselineScore,
      deltaScore: result.deltaScore,
      passedThreshold: result.score >= params.passThreshold
    }))
  };
}

export async function runParityBenchmark(params: {
  workspaceId: string;
  createdByUserId: string;
  modules?: string[];
  passThreshold: number;
}) {
  const run = await prisma.parityBenchmarkRun.create({
    data: {
      workspaceId: params.workspaceId,
      status: "RUNNING",
      modules: params.modules ?? [],
      startedAt: new Date(),
      createdByUserId: params.createdByUserId
    }
  });

  try {
    const scorecard = await buildParityScorecardForWorkspace(params.workspaceId);
    const moduleFilter = params.modules && params.modules.length > 0
      ? new Set(params.modules.map((module) => module.toLowerCase()))
      : null;
    const selectedModules = moduleFilter
      ? scorecard.modules.filter((module) => moduleFilter.has(module.module.toLowerCase()))
      : scorecard.modules;

    const results = selectedModules.map((module) => {
      const baselineScore = DescriptBaselineScoreByModule[module.module] ?? 70;
      const deltaScore = Number((module.score - baselineScore).toFixed(2));
      return ({
      runId: run.id,
      module: module.module,
      score: module.score,
      passed: module.score >= params.passThreshold,
      details: JSON.parse(JSON.stringify({
        tier: module.tier,
        title: module.title,
        evidence: module.evidence,
        scorecardPassed: module.passed,
        baselineScore,
        deltaScore,
        advantage: deltaScore >= 3
      })) as Prisma.InputJsonValue
      });
    });

    if (results.length > 0) {
      await prisma.parityBenchmarkResult.createMany({
        data: results
      });
    }

    const passedCount = results.filter((entry) => entry.passed).length;
    const benchmarkSummary = summarizeBenchmarkAgainstDescript({
      results: selectedModules.map((module) => ({
        module: module.module,
        score: module.score,
        passed: module.score >= params.passThreshold,
        tier: module.tier
      })),
      passThreshold: params.passThreshold
    });
    const updated = await prisma.parityBenchmarkRun.update({
      where: { id: run.id },
      data: {
        status: "DONE",
        finishedAt: new Date(),
        summary: {
          passThreshold: params.passThreshold,
          overallScore: scorecard.overallScore,
          selectedModuleCount: results.length,
          passedCount,
          passRate: results.length > 0 ? Number(((passedCount / results.length) * 100).toFixed(2)) : 0,
          ...benchmarkSummary
        }
      }
    });

    return {
      run: {
        id: updated.id,
        status: updated.status,
        startedAt: updated.startedAt?.toISOString() ?? null,
        finishedAt: updated.finishedAt?.toISOString() ?? null,
        summary: updated.summary
      },
      scorecard,
      results: results.map((entry) => ({
        module: entry.module,
        score: entry.score,
        passed: entry.passed,
        details: entry.details
      }))
    };
  } catch (error) {
    await prisma.parityBenchmarkRun.update({
      where: { id: run.id },
      data: {
        status: "ERROR",
        finishedAt: new Date(),
        summary: {
          error: error instanceof Error ? error.message : "Unknown benchmark failure"
        }
      }
    });
    throw error;
  }
}

export async function getParityBenchmark(runId: string, workspaceId: string) {
  const run = await prisma.parityBenchmarkRun.findFirst({
    where: {
      id: runId,
      workspaceId
    }
  });
  if (!run) {
    throw new Error("Benchmark run not found");
  }
  const results = await prisma.parityBenchmarkResult.findMany({
    where: {
      runId: run.id
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  return {
    run: {
      id: run.id,
      workspaceId: run.workspaceId,
      status: run.status,
      modules: run.modules,
      summary: run.summary,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString()
    },
    results: results.map((result) => ({
      id: result.id,
      module: result.module,
      score: result.score,
      passed: result.passed,
      details: result.details,
      createdAt: result.createdAt.toISOString()
    }))
  };
}
