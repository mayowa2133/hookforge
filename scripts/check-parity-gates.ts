import { buildParityScorecardForWorkspace } from "@/lib/parity/scorecard";
import { prisma } from "@/lib/prisma";

async function resolveWorkspaceId() {
  const explicit = process.env.PARITY_WORKSPACE_ID?.trim();
  if (explicit) {
    return explicit;
  }
  const fromStudio = await prisma.studioRoom.groupBy({
    by: ["workspaceId"],
    _count: { _all: true },
    orderBy: {
      _count: {
        id: "desc"
      }
    },
    take: 1
  });
  if (fromStudio[0]?.workspaceId) {
    return fromStudio[0].workspaceId;
  }
  const workspace = await prisma.workspace.findFirst({
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true
    }
  });
  if (!workspace) {
    throw new Error("No workspace found for parity gate check");
  }
  return workspace.id;
}

async function main() {
  const workspaceId = await resolveWorkspaceId();
  const threshold = Number(process.env.PARITY_GATE_MIN_SCORE ?? "70");
  const modulePassRateThreshold = Number(process.env.PARITY_GATE_MIN_PASS_RATE ?? "70");

  const scorecard = await buildParityScorecardForWorkspace(workspaceId);
  const gatePassed = scorecard.overallScore >= threshold && scorecard.passRate >= modulePassRateThreshold;

  console.log(
    JSON.stringify(
      {
        workspaceId: scorecard.workspaceId,
        overallScore: scorecard.overallScore,
        passRate: scorecard.passRate,
        threshold,
        modulePassRateThreshold,
        gatePassed,
        modules: scorecard.modules.map((module) => ({
          module: module.module,
          score: module.score,
          passed: module.passed
        }))
      },
      null,
      2
    )
  );

  if (!gatePassed) {
    process.exit(2);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
