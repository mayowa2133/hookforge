import { buildParityScorecardForWorkspace } from "@/lib/parity/scorecard";
import { prisma } from "@/lib/prisma";
import {
  buildReleaseEvidenceId,
  resolveReleaseWorkspace,
  resolveWorkspaceActorUserId
} from "@/scripts/parity/release-remediation-helpers";

async function ensureLegacyTemplate() {
  const templateSlug = process.env.PARITY_RELEASE_TEMPLATE_SLUG?.trim() || "parity-release-template";
  return prisma.template.upsert({
    where: { slug: templateSlug },
    update: {
      name: "Parity Release Template",
      description: "Deterministic release evidence template"
    },
    create: {
      slug: templateSlug,
      name: "Parity Release Template",
      description: "Deterministic release evidence template",
      tags: ["parity", "release"],
      slotSchema: {
        version: 1,
        slots: [
          {
            key: "main",
            kind: "VIDEO"
          }
        ]
      }
    }
  });
}

async function main() {
  const workspace = await resolveReleaseWorkspace();
  const workspaceId = workspace.workspaceId;
  const actorUserId = await resolveWorkspaceActorUserId(workspaceId);
  const template = await ensureLegacyTemplate();

  const projectV2Id = buildReleaseEvidenceId(workspaceId, "project-v2");
  const legacyProjectId = buildReleaseEvidenceId(workspaceId, "project-legacy");
  const reviewDecisionId = buildReleaseEvidenceId(workspaceId, "review-decision");
  const reviewRequestId = buildReleaseEvidenceId(workspaceId, "review-request");
  const shareLinkId = buildReleaseEvidenceId(workspaceId, "share-link");
  const shareToken = buildReleaseEvidenceId(workspaceId, "share-token");

  await prisma.projectV2.upsert({
    where: { id: projectV2Id },
    update: {
      title: "Parity Release Evidence Project",
      status: "READY",
      createdByUserId: actorUserId
    },
    create: {
      id: projectV2Id,
      workspaceId,
      createdByUserId: actorUserId,
      title: "Parity Release Evidence Project",
      status: "READY"
    }
  });

  await prisma.project.upsert({
    where: { id: legacyProjectId },
    update: {
      workspaceId,
      userId: actorUserId,
      templateId: template.id,
      title: "Parity Release Render Project",
      status: "DONE",
      config: {
        seededBy: "scripts/parity/seed-release-evidence.ts"
      }
    },
    create: {
      id: legacyProjectId,
      workspaceId,
      userId: actorUserId,
      templateId: template.id,
      title: "Parity Release Render Project",
      status: "DONE",
      config: {
        seededBy: "scripts/parity/seed-release-evidence.ts"
      }
    }
  });

  await prisma.studioRoom.upsert({
    where: {
      projectId_roomName: {
        projectId: projectV2Id,
        roomName: "parity-release-room"
      }
    },
    update: {
      workspaceId,
      hostUserId: actorUserId,
      status: "ACTIVE",
      metadata: {
        seededBy: "scripts/parity/seed-release-evidence.ts"
      }
    },
    create: {
      workspaceId,
      projectId: projectV2Id,
      hostUserId: actorUserId,
      roomName: "parity-release-room",
      status: "ACTIVE",
      metadata: {
        seededBy: "scripts/parity/seed-release-evidence.ts"
      }
    }
  });

  await prisma.transcriptSegment.upsert({
    where: { id: buildReleaseEvidenceId(workspaceId, "transcript-segment") },
    update: {
      projectId: projectV2Id,
      language: "en",
      text: "Parity release transcript segment for deterministic scorecard evidence.",
      startMs: 0,
      endMs: 2500,
      source: "ASR"
    },
    create: {
      id: buildReleaseEvidenceId(workspaceId, "transcript-segment"),
      projectId: projectV2Id,
      language: "en",
      text: "Parity release transcript segment for deterministic scorecard evidence.",
      startMs: 0,
      endMs: 2500,
      source: "ASR"
    }
  });

  await prisma.transcriptEditCheckpoint.upsert({
    where: { id: buildReleaseEvidenceId(workspaceId, "transcript-checkpoint") },
    update: {
      workspaceId,
      projectId: projectV2Id,
      language: "en",
      label: "Parity release checkpoint",
      createdByUserId: actorUserId,
      snapshot: {
        version: 1,
        segments: [
          {
            startMs: 0,
            endMs: 2500,
            text: "Parity release transcript segment for deterministic scorecard evidence."
          }
        ]
      }
    },
    create: {
      id: buildReleaseEvidenceId(workspaceId, "transcript-checkpoint"),
      workspaceId,
      projectId: projectV2Id,
      language: "en",
      label: "Parity release checkpoint",
      createdByUserId: actorUserId,
      snapshot: {
        version: 1,
        segments: [
          {
            startMs: 0,
            endMs: 2500,
            text: "Parity release transcript segment for deterministic scorecard evidence."
          }
        ]
      }
    }
  });

  await prisma.audioEnhancementRun.upsert({
    where: { id: buildReleaseEvidenceId(workspaceId, "audio-run") },
    update: {
      workspaceId,
      projectId: projectV2Id,
      createdByUserId: actorUserId,
      mode: "APPLY",
      operation: "ENHANCE",
      preset: "CLEAN_VOICE",
      status: "APPLIED",
      config: {
        profile: "studio_voice",
        denoise: "adaptive"
      },
      summary: {
        loudnessLufs: -16
      }
    },
    create: {
      id: buildReleaseEvidenceId(workspaceId, "audio-run"),
      workspaceId,
      projectId: projectV2Id,
      createdByUserId: actorUserId,
      mode: "APPLY",
      operation: "ENHANCE",
      preset: "CLEAN_VOICE",
      status: "APPLIED",
      config: {
        profile: "studio_voice",
        denoise: "adaptive"
      },
      summary: {
        loudnessLufs: -16
      }
    }
  });

  await prisma.autopilotSession.upsert({
    where: { id: buildReleaseEvidenceId(workspaceId, "autopilot-session") },
    update: {
      workspaceId,
      projectId: projectV2Id,
      prompt: "Create social clips and pacing cleanup for release parity evidence.",
      planRevisionHash: "parity-release-plan-v1",
      safetyMode: "strict",
      confidence: 0.99,
      status: "SUCCESS",
      createdByUserId: actorUserId,
      metadata: {
        seededBy: "scripts/parity/seed-release-evidence.ts"
      }
    },
    create: {
      id: buildReleaseEvidenceId(workspaceId, "autopilot-session"),
      workspaceId,
      projectId: projectV2Id,
      prompt: "Create social clips and pacing cleanup for release parity evidence.",
      planRevisionHash: "parity-release-plan-v1",
      safetyMode: "strict",
      confidence: 0.99,
      status: "SUCCESS",
      createdByUserId: actorUserId,
      metadata: {
        seededBy: "scripts/parity/seed-release-evidence.ts"
      }
    }
  });

  await prisma.reviewDecision.upsert({
    where: { id: reviewDecisionId },
    update: {
      workspaceId,
      projectId: projectV2Id,
      decidedByUserId: actorUserId,
      status: "APPROVED",
      note: "Parity release seed decision"
    },
    create: {
      id: reviewDecisionId,
      workspaceId,
      projectId: projectV2Id,
      decidedByUserId: actorUserId,
      status: "APPROVED",
      note: "Parity release seed decision"
    }
  });

  await prisma.reviewRequest.upsert({
    where: { id: reviewRequestId },
    update: {
      workspaceId,
      projectId: projectV2Id,
      requestedByUserId: actorUserId,
      title: "Parity release review request",
      note: "Seeded to satisfy deterministic certification evidence.",
      requiredScopes: ["APPROVE"],
      status: "APPROVED",
      decisionId: reviewDecisionId,
      decidedAt: new Date(),
      decidedByUserId: actorUserId,
      metadata: {
        seededBy: "scripts/parity/seed-release-evidence.ts"
      }
    },
    create: {
      id: reviewRequestId,
      workspaceId,
      projectId: projectV2Id,
      requestedByUserId: actorUserId,
      title: "Parity release review request",
      note: "Seeded to satisfy deterministic certification evidence.",
      requiredScopes: ["APPROVE"],
      status: "APPROVED",
      decisionId: reviewDecisionId,
      decidedAt: new Date(),
      decidedByUserId: actorUserId,
      metadata: {
        seededBy: "scripts/parity/seed-release-evidence.ts"
      }
    }
  });

  await prisma.reviewDecisionLog.create({
    data: {
      workspaceId,
      projectId: projectV2Id,
      requestId: reviewRequestId,
      decidedByUserId: actorUserId,
      status: "APPROVED",
      note: "Parity release seeded decision log entry.",
      metadata: {
        seededBy: "scripts/parity/seed-release-evidence.ts",
        decisionId: reviewDecisionId
      }
    }
  });

  await prisma.shareLink.upsert({
    where: { id: shareLinkId },
    update: {
      workspaceId,
      projectId: projectV2Id,
      createdByUserId: actorUserId,
      token: shareToken,
      scope: "APPROVE",
      revokedAt: null,
      expiresAt: null,
      metadata: {
        seededBy: "scripts/parity/seed-release-evidence.ts"
      }
    },
    create: {
      id: shareLinkId,
      workspaceId,
      projectId: projectV2Id,
      createdByUserId: actorUserId,
      token: shareToken,
      scope: "APPROVE",
      revokedAt: null,
      expiresAt: null,
      metadata: {
        seededBy: "scripts/parity/seed-release-evidence.ts"
      }
    }
  });

  await prisma.publishConnectorJob.create({
    data: {
      workspaceId,
      projectId: projectV2Id,
      connector: "youtube",
      status: "DONE",
      payload: {
        title: "Parity release export"
      },
      output: {
        url: "https://example.com/hookforge/parity-release-export"
      },
      createdByUserId: actorUserId
    }
  });

  await prisma.renderJob.create({
    data: {
      projectId: legacyProjectId,
      status: "DONE",
      progress: 100,
      outputStorageKey: "renders/parity-release.mp4"
    }
  });

  await prisma.aIJob.create({
    data: {
      workspaceId,
      projectId: projectV2Id,
      type: "AI_EDIT",
      status: "DONE",
      progress: 100,
      providerHint: "release-seed",
      input: {
        prompt: "Seed deterministic reliability evidence."
      },
      output: {
        status: "ok"
      }
    }
  });

  const scorecard = await buildParityScorecardForWorkspace(workspaceId);
  const failedModules = scorecard.modules.filter((module) => !module.passed).map((module) => module.module);
  const allModulesPassed = failedModules.length === 0;

  console.log(
    JSON.stringify(
      {
        workspaceId,
        actorUserId,
        projectV2Id,
        legacyProjectId,
        scorecard: {
          overallScore: scorecard.overallScore,
          passRate: scorecard.passRate,
          passedModules: scorecard.passedModules,
          totalModules: scorecard.totalModules,
          failedModules
        },
        allModulesPassed
      },
      null,
      2
    )
  );

  if (!allModulesPassed) {
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
