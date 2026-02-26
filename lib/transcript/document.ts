import { randomUUID } from "crypto";
import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { appendTimelineRevision } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { sanitizeOverlayText } from "@/lib/sanitize";
import { getTranscript, patchTranscript, type TranscriptPatchInput } from "@/lib/transcript/service";

const SearchReplaceSchema = z.object({
  language: z.string().trim().min(2).max(12).default("en"),
  search: z.string().trim().min(1).max(120),
  replace: z.string().max(240),
  caseSensitive: z.boolean().default(false),
  maxSegments: z.number().int().min(1).max(2000).default(500)
});

type SearchReplaceInput = z.infer<typeof SearchReplaceSchema>;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAllMatches(params: {
  text: string;
  search: string;
  replace: string;
  caseSensitive: boolean;
}) {
  const flags = params.caseSensitive ? "g" : "gi";
  const pattern = new RegExp(escapeRegExp(params.search), flags);
  const next = params.text.replace(pattern, params.replace);
  const changed = next !== params.text;
  return { changed, text: next };
}

export function buildSearchReplaceOperations(params: {
  segments: Array<{ id: string; text: string; startMs: number; endMs: number; confidenceAvg: number | null }>;
  search: string;
  replace: string;
  caseSensitive: boolean;
  maxSegments: number;
}) {
  const operations: TranscriptPatchInput["operations"] = [];
  const matches: Array<{
    segmentId: string;
    before: string;
    after: string;
    startMs: number;
    endMs: number;
    confidenceAvg: number | null;
  }> = [];

  for (const segment of params.segments) {
    if (operations.length >= params.maxSegments) {
      break;
    }
    const replaced = replaceAllMatches({
      text: segment.text,
      search: params.search,
      replace: params.replace,
      caseSensitive: params.caseSensitive
    });
    if (!replaced.changed) {
      continue;
    }
    operations.push({
      op: "replace_text",
      segmentId: segment.id,
      text: sanitizeOverlayText(replaced.text, "transcript")
    });
    matches.push({
      segmentId: segment.id,
      before: segment.text,
      after: replaced.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      confidenceAvg: segment.confidenceAvg
    });
  }

  return { operations, matches };
}

export async function previewTranscriptSearchReplace(projectIdOrV2Id: string, rawInput: SearchReplaceInput) {
  const input = SearchReplaceSchema.parse(rawInput);
  const transcript = await getTranscript(projectIdOrV2Id, input.language);
  const built = buildSearchReplaceOperations({
    segments: transcript.segments.map((segment) => ({
      id: segment.id,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      confidenceAvg: segment.confidenceAvg ?? null
    })),
    search: input.search,
    replace: input.replace,
    caseSensitive: input.caseSensitive,
    maxSegments: input.maxSegments
  });

  const result = await patchTranscript(projectIdOrV2Id, {
    language: transcript.language,
    operations: built.operations,
    minConfidenceForRipple: 0.86,
    previewOnly: true
  });

  return {
    mode: "PREVIEW" as const,
    query: {
      search: input.search,
      replace: input.replace,
      caseSensitive: input.caseSensitive
    },
    affectedSegments: built.matches.length,
    matches: built.matches,
    ...result
  };
}

export async function createTranscriptCheckpoint(params: {
  projectIdOrV2Id: string;
  language?: string;
  label?: string;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const transcript = await getTranscript(ctx.projectV2.id, params.language ?? "en");
  const checkpoint = await prisma.transcriptEditCheckpoint.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      language: transcript.language,
      label: sanitizeOverlayText(params.label ?? `checkpoint-${new Date().toISOString()}`, "checkpoint"),
      snapshot: {
        language: transcript.language,
        segments: transcript.segments,
        words: transcript.words,
        qualitySummary: transcript.qualitySummary
      },
      createdByUserId: ctx.user.id
    }
  });
  return {
    checkpoint: {
      id: checkpoint.id,
      language: checkpoint.language,
      label: checkpoint.label,
      createdAt: checkpoint.createdAt.toISOString()
    }
  };
}

export async function listTranscriptCheckpoints(projectIdOrV2Id: string, language?: string) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const checkpoints = await prisma.transcriptEditCheckpoint.findMany({
    where: {
      projectId: ctx.projectV2.id,
      ...(language ? { language: language.trim().toLowerCase() } : {})
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 200
  });
  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    checkpoints: checkpoints.map((entry) => ({
      id: entry.id,
      language: entry.language,
      label: entry.label,
      createdAt: entry.createdAt.toISOString(),
      createdByUserId: entry.createdByUserId
    }))
  };
}

export async function restoreTranscriptCheckpoint(params: {
  projectIdOrV2Id: string;
  checkpointId: string;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const checkpoint = await prisma.transcriptEditCheckpoint.findFirst({
    where: {
      id: params.checkpointId,
      projectId: ctx.projectV2.id,
      workspaceId: ctx.workspace.id
    }
  });
  if (!checkpoint) {
    throw new Error("Checkpoint not found");
  }

  const snapshot = checkpoint.snapshot as {
    language?: string;
    segments?: Array<{
      id?: string;
      text: string;
      startMs: number;
      endMs: number;
      speakerLabel?: string | null;
      confidenceAvg?: number | null;
      source?: string;
    }>;
    words?: Array<{
      id?: string;
      text: string;
      startMs: number;
      endMs: number;
      speakerLabel?: string | null;
      confidence?: number | null;
      segmentId?: string | null;
    }>;
  };

  const language = snapshot.language?.trim().toLowerCase() || checkpoint.language;
  const segments = Array.isArray(snapshot.segments) ? snapshot.segments : [];
  const words = Array.isArray(snapshot.words) ? snapshot.words : [];

  if (segments.length === 0 || words.length === 0) {
    await prisma.transcriptConflictIssue.create({
      data: {
        workspaceId: ctx.workspace.id,
        projectId: ctx.projectV2.id,
        checkpointId: checkpoint.id,
        issueType: "TIMING_DRIFT",
        severity: "HIGH",
        message: "Checkpoint snapshot is incomplete and cannot be restored."
      }
    });
    throw new Error("Checkpoint snapshot is incomplete");
  }

  const segmentIdMap = new Map<string, string>();
  const newSegments = segments.map((segment) => {
    const id = randomUUID();
    if (segment.id) {
      segmentIdMap.set(segment.id, id);
    }
    return {
      id,
      projectId: ctx.projectV2.id,
      language,
      text: sanitizeOverlayText(segment.text, "transcript"),
      startMs: Math.max(0, Math.trunc(segment.startMs)),
      endMs: Math.max(Math.trunc(segment.endMs), Math.trunc(segment.startMs) + 1),
      speakerLabel: segment.speakerLabel ?? null,
      confidenceAvg: segment.confidenceAvg ?? null,
      source: segment.source ?? "CHECKPOINT_RESTORE"
    };
  });

  const newWords = words.map((word) => ({
    id: randomUUID(),
    projectId: ctx.projectV2.id,
    text: sanitizeOverlayText(word.text, "word"),
    startMs: Math.max(0, Math.trunc(word.startMs)),
    endMs: Math.max(Math.trunc(word.endMs), Math.trunc(word.startMs) + 1),
    speakerLabel: word.speakerLabel ?? null,
    confidence: word.confidence ?? null,
    segmentId: word.segmentId ? (segmentIdMap.get(word.segmentId) ?? null) : null
  }));

  const captionTrack = await prisma.timelineTrack.findFirst({
    where: {
      projectId: ctx.projectV2.id,
      kind: "CAPTION"
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  await prisma.$transaction(async (tx) => {
    await tx.transcriptWord.deleteMany({
      where: {
        projectId: ctx.projectV2.id
      }
    });
    await tx.transcriptSegment.deleteMany({
      where: {
        projectId: ctx.projectV2.id,
        language
      }
    });
    await tx.transcriptSegment.createMany({
      data: newSegments
    });
    await tx.transcriptWord.createMany({
      data: newWords
    });
    await tx.captionSegment.deleteMany({
      where: {
        projectId: ctx.projectV2.id,
        language
      }
    });
    await tx.captionSegment.createMany({
      data: newSegments.map((segment) => ({
        projectId: ctx.projectV2.id,
        trackId: captionTrack?.id ?? null,
        language,
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs
      }))
    });
  });

  const revision = await appendTimelineRevision({
    projectId: ctx.projectV2.id,
    createdByUserId: ctx.user.id,
    operations: {
      source: "transcript_checkpoint_restore",
      checkpointId: checkpoint.id,
      language,
      restoredSegments: newSegments.length,
      restoredWords: newWords.length
    }
  });

  return {
    restored: true,
    checkpointId: checkpoint.id,
    revisionId: revision.id,
    language,
    restoredSegments: newSegments.length,
    restoredWords: newWords.length
  };
}

export async function applyTranscriptSearchReplace(projectIdOrV2Id: string, rawInput: SearchReplaceInput) {
  const input = SearchReplaceSchema.parse(rawInput);
  const checkpoint = await createTranscriptCheckpoint({
    projectIdOrV2Id,
    language: input.language,
    label: `search-replace:${input.search}`
  });
  const transcript = await getTranscript(projectIdOrV2Id, input.language);
  const built = buildSearchReplaceOperations({
    segments: transcript.segments.map((segment) => ({
      id: segment.id,
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      confidenceAvg: segment.confidenceAvg ?? null
    })),
    search: input.search,
    replace: input.replace,
    caseSensitive: input.caseSensitive,
    maxSegments: input.maxSegments
  });
  const result = await patchTranscript(projectIdOrV2Id, {
    language: transcript.language,
    operations: built.operations,
    minConfidenceForRipple: 0.86,
    previewOnly: false
  });
  return {
    mode: "APPLY" as const,
    checkpoint: checkpoint.checkpoint,
    query: {
      search: input.search,
      replace: input.replace,
      caseSensitive: input.caseSensitive
    },
    affectedSegments: built.matches.length,
    matches: built.matches,
    ...result
  };
}
