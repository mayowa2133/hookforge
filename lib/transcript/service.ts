import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { requireProjectContext } from "@/lib/api-context";
import { applyTranscriptPatchOperations, summarizeTranscriptQuality, type TranscriptPatchOperation } from "@/lib/transcript/operations";
import { assignSegmentIdsToWords, buildTranscriptSegmentsFromWords } from "@/lib/transcript/segmentation";
import { previewTimelineOperationsWithValidation } from "@/lib/timeline-invariants";
import { appendTimelineRevision } from "@/lib/project-v2";
import { buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";
import { prisma } from "@/lib/prisma";
import { sanitizeOverlayText } from "@/lib/sanitize";

const CAPTION_STYLE_NAME = "HookForge Bold";

export type TranscriptAutoInput = {
  language: string;
  diarization: boolean;
  punctuationStyle: "auto" | "minimal" | "full";
  confidenceThreshold: number;
  reDecodeEnabled: boolean;
  maxWordsPerSegment: number;
  maxCharsPerLine: number;
  maxLinesPerSegment: number;
};

export type TranscriptPatchInput = {
  language: string;
  operations: TranscriptPatchOperation[];
  minConfidenceForRipple: number;
  previewOnly?: boolean;
};

async function ensureCaptionStylePreset(workspaceId: string) {
  const existing = await prisma.captionStylePreset.findFirst({
    where: {
      workspaceId,
      name: CAPTION_STYLE_NAME
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.captionStylePreset.create({
    data: {
      workspaceId,
      name: CAPTION_STYLE_NAME,
      isSystem: true,
      config: {
        fontFamily: "Space Grotesk",
        fontSize: 42,
        bgOpacity: 0.72,
        radius: 16,
        uppercase: false
      }
    }
  });
}

async function ensureCaptionTrack(projectId: string, currentRevisionId: string | null, language: string) {
  const trackName = `Auto captions (${language})`;
  const existing = await prisma.timelineTrack.findFirst({
    where: {
      projectId,
      kind: "CAPTION",
      name: trackName
    }
  });
  if (existing) {
    return existing;
  }

  return prisma.timelineTrack.create({
    data: {
      projectId,
      revisionId: currentRevisionId,
      kind: "CAPTION",
      name: trackName,
      sortOrder: 999
    }
  });
}

async function buildProjectContextFromAnyId(projectIdOrV2Id: string) {
  return requireProjectContext(projectIdOrV2Id);
}

export async function enqueueTranscriptAuto(projectIdOrV2Id: string, input: TranscriptAutoInput) {
  const ctx = await buildProjectContextFromAnyId(projectIdOrV2Id);
  const captionTrack = await ensureCaptionTrack(ctx.projectV2.id, ctx.projectV2.currentRevisionId, input.language);

  const aiJob = await enqueueAIJob({
    workspaceId: ctx.workspace.id,
    projectId: ctx.projectV2.id,
    type: "TRANSCRIBE",
    queueName: queueNameForJobType("TRANSCRIBE"),
    input: {
      language: input.language,
      diarization: input.diarization,
      punctuationStyle: input.punctuationStyle,
      confidenceThreshold: input.confidenceThreshold,
      reDecodeEnabled: input.reDecodeEnabled,
      maxWordsPerSegment: input.maxWordsPerSegment,
      maxCharsPerLine: input.maxCharsPerLine,
      maxLinesPerSegment: input.maxLinesPerSegment,
      captionTrackId: captionTrack.id,
      legacyProjectId: ctx.legacyProject.id
    }
  });

  return {
    aiJob,
    trackId: captionTrack.id,
    projectV2Id: ctx.projectV2.id
  };
}

export async function getTranscript(projectIdOrV2Id: string, language?: string) {
  const ctx = await buildProjectContextFromAnyId(projectIdOrV2Id);
  const normalizedLanguage = (language?.trim().toLowerCase() || "en");

  const [segments, words] = await Promise.all([
    prisma.transcriptSegment.findMany({
      where: {
        projectId: ctx.projectV2.id,
        language: normalizedLanguage
      },
      orderBy: {
        startMs: "asc"
      }
    }),
    prisma.transcriptWord.findMany({
      where: {
        projectId: ctx.projectV2.id
      },
      orderBy: {
        startMs: "asc"
      }
    })
  ]);

  if (segments.length === 0 && words.length > 0) {
    const derived = buildTranscriptSegmentsFromWords(words, {
      maxWordsPerSegment: 7,
      maxCharsPerLine: 24,
      maxLinesPerSegment: 2
    }).map((segment) => ({
      id: randomUUID(),
      projectId: ctx.projectV2.id,
      language: normalizedLanguage,
      text: sanitizeOverlayText(segment.text, "caption"),
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerLabel: segment.speakerLabel ?? null,
      confidenceAvg: segment.confidenceAvg ?? null,
      source: "BACKFILL"
    }));

    if (derived.length > 0) {
      await prisma.transcriptSegment.createMany({
        data: derived
      });
      const withSegmentIds = assignSegmentIdsToWords(words, derived.map((segment) => ({
        id: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        speakerLabel: segment.speakerLabel,
        confidenceAvg: segment.confidenceAvg
      })));
      await prisma.$transaction(
        withSegmentIds.map((word) =>
          prisma.transcriptWord.update({
            where: { id: word.id! },
            data: {
              segmentId: word.segmentId
            }
          })
        )
      );
    }
  }

  const refreshedSegments = await prisma.transcriptSegment.findMany({
    where: {
      projectId: ctx.projectV2.id,
      language: normalizedLanguage
    },
    orderBy: {
      startMs: "asc"
    }
  });
  const refreshedWords = await prisma.transcriptWord.findMany({
    where: {
      projectId: ctx.projectV2.id
    },
    orderBy: {
      startMs: "asc"
    }
  });

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    language: normalizedLanguage,
    segments: refreshedSegments,
    words: refreshedWords,
    qualitySummary: summarizeTranscriptQuality({
      words: refreshedWords,
      segments: refreshedSegments
    })
  };
}

export async function patchTranscript(projectIdOrV2Id: string, input: TranscriptPatchInput) {
  const ctx = await buildProjectContextFromAnyId(projectIdOrV2Id);
  const normalizedLanguage = input.language.trim().toLowerCase();

  const [legacyProject, segments] = await Promise.all([
    prisma.project.findUnique({
      where: { id: ctx.legacyProject.id },
      select: {
        id: true,
        userId: true,
        config: true,
        assets: {
          select: {
            id: true,
            slotKey: true,
            kind: true,
            durationSec: true
          }
        }
      }
    }),
    prisma.transcriptSegment.findMany({
      where: {
        projectId: ctx.projectV2.id,
        language: normalizedLanguage
      },
      orderBy: {
        startMs: "asc"
      }
    })
  ]);

  if (!legacyProject) {
    throw new Error("Project not found");
  }
  if (segments.length === 0) {
    throw new Error("No transcript segments available. Generate transcript first.");
  }

  const timelineState = buildTimelineState(
    legacyProject.config,
    legacyProject.assets as Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }>
  );

  const applyResult = applyTranscriptPatchOperations({
    state: timelineState,
    language: normalizedLanguage,
    segments: segments.map((segment) => ({
      id: segment.id,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      speakerLabel: segment.speakerLabel,
      confidenceAvg: segment.confidenceAvg
    })),
    operations: input.operations,
    minConfidenceForRipple: input.minConfidenceForRipple
  });

  if (applyResult.suggestionsOnly || input.previewOnly) {
    return {
      applied: false,
      suggestionsOnly: true,
      timelineOps: applyResult.timelineOperations,
      issues: applyResult.issues,
      revisionId: null,
      qualitySummary: summarizeTranscriptQuality({
        words: applyResult.nextWords,
        segments: applyResult.nextSegments
      })
    };
  }

  const preview = previewTimelineOperationsWithValidation({
    state: timelineState,
    operations: applyResult.timelineOperations
  });

  if (!preview.valid || !preview.nextState) {
    return {
      applied: false,
      suggestionsOnly: true,
      timelineOps: applyResult.timelineOperations,
      issues: [
        ...applyResult.issues,
        ...preview.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          severity: "ERROR" as const
        }))
      ],
      revisionId: null,
      qualitySummary: summarizeTranscriptQuality({
        words: applyResult.nextWords,
        segments: applyResult.nextSegments
      })
    };
  }
  const nextTimelineState = preview.nextState;

  const stylePreset = await ensureCaptionStylePreset(ctx.workspace.id);
  const captionTrack = await ensureCaptionTrack(ctx.projectV2.id, ctx.projectV2.currentRevisionId, normalizedLanguage);

  await prisma.$transaction(async (tx) => {
    await tx.transcriptWord.deleteMany({
      where: {
        projectId: ctx.projectV2.id
      }
    });
    await tx.transcriptSegment.deleteMany({
      where: {
        projectId: ctx.projectV2.id,
        language: normalizedLanguage
      }
    });
    await tx.captionSegment.deleteMany({
      where: {
        projectId: ctx.projectV2.id,
        language: normalizedLanguage
      }
    });

    if (applyResult.nextSegments.length > 0) {
      await tx.transcriptSegment.createMany({
        data: applyResult.nextSegments.map((segment) => ({
          id: segment.id,
          projectId: ctx.projectV2.id,
          language: normalizedLanguage,
          text: sanitizeOverlayText(segment.text, "caption"),
          startMs: segment.startMs,
          endMs: segment.endMs,
          speakerLabel: segment.speakerLabel ?? null,
          confidenceAvg: segment.confidenceAvg ?? null,
          source: "PATCH"
        }))
      });
      await tx.captionSegment.createMany({
        data: applyResult.nextSegments.map((segment) => ({
          projectId: ctx.projectV2.id,
          trackId: captionTrack.id,
          language: normalizedLanguage,
          text: sanitizeOverlayText(segment.text, "caption"),
          startMs: segment.startMs,
          endMs: segment.endMs,
          stylePresetId: stylePreset.id
        }))
      });
    }

    const wordsWithSegmentId = assignSegmentIdsToWords(
      applyResult.nextWords.map((word) => ({
        ...word,
        id: randomUUID()
      })),
      applyResult.nextSegments
    );
    if (wordsWithSegmentId.length > 0) {
      await tx.transcriptWord.createMany({
        data: wordsWithSegmentId.map((word) => ({
          id: word.id!,
          projectId: ctx.projectV2.id,
          segmentId: word.segmentId,
          startMs: word.startMs,
          endMs: word.endMs,
          text: sanitizeOverlayText(word.text, "word"),
          speakerLabel: word.speakerLabel ?? null,
          confidence: word.confidence ?? null
        }))
      });
    }

    const configRecord = (typeof legacyProject.config === "object" && legacyProject.config !== null
      ? legacyProject.config
      : {}) as Record<string, unknown>;
    const nextConfig = serializeTimelineState(configRecord, nextTimelineState);

    await tx.project.update({
      where: {
        id: legacyProject.id
      },
      data: {
        config: nextConfig as Prisma.InputJsonValue
      }
    });
  });

  const revision = await appendTimelineRevision({
    projectId: ctx.projectV2.id,
    createdByUserId: ctx.user.id,
    operations: {
      transcriptPatch: input.operations,
      timelineOps: applyResult.timelineOperations,
      issues: applyResult.issues
    }
  });

  return {
    applied: true,
    suggestionsOnly: false,
    timelineOps: applyResult.timelineOperations,
    issues: applyResult.issues,
    revisionId: revision.id,
    qualitySummary: summarizeTranscriptQuality({
      words: applyResult.nextWords,
      segments: applyResult.nextSegments
    })
  };
}
