import { prisma } from "@/lib/prisma";

export const parityCapabilityRegistry = [
  { module: "recording", title: "Recording System Parity", tier: "Descript parity" },
  { module: "transcript", title: "Transcript-Native Editing", tier: "Descript parity" },
  { module: "audio", title: "Audio Quality Stack", tier: "Descript parity" },
  { module: "autopilot", title: "AI-Safe Edit Autopilot", tier: "Descript+" },
  { module: "collaboration", title: "Review and Approval", tier: "Descript parity" },
  { module: "publishing", title: "Publishing and Export", tier: "Descript parity" },
  { module: "reliability", title: "Reliability and SLO", tier: "Descript+" }
] as const;

export type ParityModuleScore = {
  module: (typeof parityCapabilityRegistry)[number]["module"];
  title: string;
  tier: string;
  score: number;
  passed: boolean;
  evidence: Record<string, unknown>;
};

function clampScore(score: number) {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(score.toFixed(2))));
}

function pct(part: number, total: number) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return (part / total) * 100;
}

export function buildParityScorecardModules(input: {
  studioRoomCount: number;
  recordingRecoveryCount: number;
  transcriptSegmentCount: number;
  checkpointCount: number;
  audioRunCount: number;
  autopilotSessionCount: number;
  reviewDecisionCount: number;
  publishDoneCount: number;
  publishTotalCount: number;
  renderDoneCount: number;
  renderTotalCount: number;
  aiDoneCount: number;
  aiTotalCount: number;
}): ParityModuleScore[] {
  const renderSuccessRate = pct(input.renderDoneCount, input.renderTotalCount);
  const aiSuccessRate = pct(input.aiDoneCount, input.aiTotalCount);
  const publishSuccessRate = pct(input.publishDoneCount, input.publishTotalCount);

  const modules: ParityModuleScore[] = [
    {
      module: "recording",
      title: "Recording System Parity",
      tier: "Descript parity",
      score: clampScore(input.studioRoomCount * 10 + input.recordingRecoveryCount * 8),
      passed: input.studioRoomCount > 0,
      evidence: {
        studioRoomCount: input.studioRoomCount,
        recordingRecoveryCount: input.recordingRecoveryCount
      }
    },
    {
      module: "transcript",
      title: "Transcript-Native Editing",
      tier: "Descript parity",
      score: clampScore(input.transcriptSegmentCount > 0 ? 65 + Math.min(35, input.checkpointCount * 5) : 0),
      passed: input.transcriptSegmentCount > 0,
      evidence: {
        transcriptSegmentCount: input.transcriptSegmentCount,
        checkpointCount: input.checkpointCount
      }
    },
    {
      module: "audio",
      title: "Audio Quality Stack",
      tier: "Descript parity",
      score: clampScore(input.audioRunCount > 0 ? 70 + Math.min(30, input.audioRunCount) : 0),
      passed: input.audioRunCount > 0,
      evidence: {
        audioRunCount: input.audioRunCount
      }
    },
    {
      module: "autopilot",
      title: "AI-Safe Edit Autopilot",
      tier: "Descript+",
      score: clampScore(input.autopilotSessionCount > 0 ? 72 + Math.min(28, input.autopilotSessionCount * 2) : 0),
      passed: input.autopilotSessionCount > 0,
      evidence: {
        autopilotSessionCount: input.autopilotSessionCount
      }
    },
    {
      module: "collaboration",
      title: "Review and Approval",
      tier: "Descript parity",
      score: clampScore(input.reviewDecisionCount > 0 ? 68 + Math.min(32, input.reviewDecisionCount * 3) : 0),
      passed: input.reviewDecisionCount > 0,
      evidence: {
        reviewDecisionCount: input.reviewDecisionCount
      }
    },
    {
      module: "publishing",
      title: "Publishing and Export",
      tier: "Descript parity",
      score: clampScore(input.publishTotalCount > 0 ? publishSuccessRate : 0),
      passed: input.publishDoneCount > 0 && publishSuccessRate >= 70,
      evidence: {
        publishDoneCount: input.publishDoneCount,
        publishTotalCount: input.publishTotalCount,
        publishSuccessRate
      }
    },
    {
      module: "reliability",
      title: "Reliability and SLO",
      tier: "Descript+",
      score: clampScore((renderSuccessRate * 0.6) + (aiSuccessRate * 0.4)),
      passed: renderSuccessRate >= 95 && aiSuccessRate >= 90,
      evidence: {
        renderDoneCount: input.renderDoneCount,
        renderTotalCount: input.renderTotalCount,
        renderSuccessRate,
        aiDoneCount: input.aiDoneCount,
        aiTotalCount: input.aiTotalCount,
        aiSuccessRate
      }
    }
  ];

  return modules;
}

export async function buildParityScorecardForWorkspace(workspaceId: string) {
  const [
    studioRoomCount,
    recordingRecoveryCount,
    transcriptSegmentCount,
    checkpointCount,
    audioRunCount,
    autopilotSessionCount,
    reviewDecisionCount,
    publishCounts,
    renderCounts,
    aiCounts
  ] = await Promise.all([
    prisma.studioRoom.count({ where: { workspaceId } }),
    prisma.recordingRecovery.count({ where: { workspaceId } }),
    prisma.transcriptSegment.count({
      where: {
        project: {
          workspaceId
        }
      }
    }),
    prisma.transcriptEditCheckpoint.count({ where: { workspaceId } }),
    prisma.audioEnhancementRun.count({ where: { workspaceId } }),
    prisma.autopilotSession.count({ where: { workspaceId } }),
    prisma.reviewDecision.count({ where: { workspaceId } }),
    prisma.publishConnectorJob.groupBy({
      by: ["status"],
      where: { workspaceId },
      _count: { _all: true }
    }),
    prisma.renderJob.groupBy({
      by: ["status"],
      where: {
        project: {
          workspaceId
        }
      },
      _count: { _all: true }
    }),
    prisma.aIJob.groupBy({
      by: ["status"],
      where: { workspaceId },
      _count: { _all: true }
    })
  ]);

  const publishTotalCount = publishCounts.reduce((sum, row) => sum + row._count._all, 0);
  const publishDoneCount = publishCounts.find((row) => row.status === "DONE")?._count._all ?? 0;
  const renderTotalCount = renderCounts.reduce((sum, row) => sum + row._count._all, 0);
  const renderDoneCount = renderCounts.find((row) => row.status === "DONE")?._count._all ?? 0;
  const aiTotalCount = aiCounts.reduce((sum, row) => sum + row._count._all, 0);
  const aiDoneCount = aiCounts.find((row) => row.status === "DONE")?._count._all ?? 0;

  const modules = buildParityScorecardModules({
    studioRoomCount,
    recordingRecoveryCount,
    transcriptSegmentCount,
    checkpointCount,
    audioRunCount,
    autopilotSessionCount,
    reviewDecisionCount,
    publishDoneCount,
    publishTotalCount,
    renderDoneCount,
    renderTotalCount,
    aiDoneCount,
    aiTotalCount
  });

  const overallScore = clampScore(modules.reduce((sum, module) => sum + module.score, 0) / modules.length);
  const passedModules = modules.filter((module) => module.passed).length;

  return {
    workspaceId,
    overallScore,
    passedModules,
    totalModules: modules.length,
    passRate: clampScore((passedModules / modules.length) * 100),
    modules,
    capabilityRegistry: parityCapabilityRegistry
  };
}
