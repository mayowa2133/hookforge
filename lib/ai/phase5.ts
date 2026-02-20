import { join } from "path";
import type { AIJob, AIJobType, MediaSource } from "@prisma/client";
import { prisma } from "../prisma";
import { isSupportedLanguage } from "../languages";
import { copyStorageObject, uploadFileToStorage } from "../storage";
import { probeStorageAsset } from "../ffprobe";

const VIDEO_MIME = "video/mp4";
const MAX_TARGET_LANGUAGES = 8;

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeLanguage(code: string) {
  return code.trim().toLowerCase();
}

export function normalizeTargetLanguages(targetLanguages: string[]) {
  const deduped = [...new Set(targetLanguages.map(normalizeLanguage))];
  return deduped.filter((language) => isSupportedLanguage(language)).slice(0, MAX_TARGET_LANGUAGES);
}

export function estimatePhase5DubbingCredits(params: {
  targetLanguageCount: number;
  lipDub: boolean;
  channel: "internal" | "public";
}) {
  const count = Math.max(1, Math.min(MAX_TARGET_LANGUAGES, Math.trunc(params.targetLanguageCount)));
  const perLanguage = params.channel === "public" ? 100 : 120;
  const lipSyncPremium = params.channel === "public" ? 70 : 80;
  return count * perLanguage + (params.lipDub ? lipSyncPremium : 0);
}

async function resolveSourceForDubbing(params: { aiJob: AIJob; input: Record<string, unknown> }) {
  const sourceAssetId = asString(params.input.sourceAssetId);
  if (sourceAssetId) {
    const [legacyAsset, mediaAsset] = await Promise.all([
      prisma.asset.findUnique({
        where: { id: sourceAssetId },
        include: {
          project: {
            select: {
              id: true,
              workspaceId: true
            }
          }
        }
      }),
      prisma.mediaAsset.findFirst({
        where: {
          id: sourceAssetId,
          workspaceId: params.aiJob.workspaceId
        }
      })
    ]);

    if (legacyAsset?.project && legacyAsset.project.workspaceId === params.aiJob.workspaceId) {
      return {
        mediaAssetId: null as string | null,
        legacyProjectId: legacyAsset.project.id,
        storageKey: legacyAsset.storageKey,
        mimeType: legacyAsset.mimeType,
        durationSec: legacyAsset.durationSec,
        width: legacyAsset.width,
        height: legacyAsset.height,
        sourceType: "UPLOAD" as MediaSource
      };
    }

    if (mediaAsset) {
      return {
        mediaAssetId: mediaAsset.id,
        legacyProjectId: null,
        storageKey: mediaAsset.storageKey,
        mimeType: mediaAsset.mimeType,
        durationSec: mediaAsset.durationSec,
        width: mediaAsset.width,
        height: mediaAsset.height,
        sourceType: mediaAsset.source
      };
    }
  }

  const sourceStorageKey = asString(params.input.sourceStorageKey);
  if (sourceStorageKey) {
    return {
      mediaAssetId: null as string | null,
      legacyProjectId: null,
      storageKey: sourceStorageKey,
      mimeType: VIDEO_MIME,
      durationSec: null,
      width: null,
      height: null,
      sourceType: "URL_IMPORT" as MediaSource
    };
  }

  const sourceUrl = asString(params.input.sourceMediaUrl) || asString(params.input.sourceUrl);
  if (sourceUrl) {
    return {
      mediaAssetId: null as string | null,
      legacyProjectId: null,
      storageKey: null,
      mimeType: VIDEO_MIME,
      durationSec: null,
      width: null,
      height: null,
      sourceType: "URL_IMPORT" as MediaSource
    };
  }

  return null;
}

async function ensureSourceMediaAsset(params: {
  aiJob: AIJob;
  source: {
    mediaAssetId: string | null;
    storageKey: string;
    mimeType: string;
    durationSec: number | null;
    width: number | null;
    height: number | null;
    sourceType: MediaSource;
  };
}) {
  if (params.source.mediaAssetId) {
    return params.source.mediaAssetId;
  }

  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      workspaceId: params.aiJob.workspaceId,
      projectId: params.aiJob.projectId ?? null,
      source: params.source.sourceType,
      storageKey: params.source.storageKey,
      mimeType: params.source.mimeType,
      durationSec: params.source.durationSec,
      width: params.source.width,
      height: params.source.height
    }
  });

  return mediaAsset.id;
}

async function materializeArtifactFromSource(params: {
  aiJob: AIJob;
  sourceStorageKey: string;
  targetLanguage: string;
  lipDub: boolean;
}) {
  const variant = params.lipDub ? "lipsync" : "dub";
  const storageKey = `ai/phase5/${params.aiJob.workspaceId}/${params.aiJob.id}/${variant}/${params.targetLanguage}.mp4`;

  try {
    await copyStorageObject({
      sourceKey: params.sourceStorageKey,
      destinationKey: storageKey,
      contentType: VIDEO_MIME
    });
  } catch {
    const demoSource = join(process.cwd(), "public", "demo-assets", "demo-portrait.mp4");
    await uploadFileToStorage(storageKey, demoSource, VIDEO_MIME);
  }

  const probe = await probeStorageAsset(storageKey);
  return {
    language: params.targetLanguage,
    storageKey,
    mimeType: VIDEO_MIME,
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height
  };
}

async function materializeArtifactFromDemo(params: { aiJob: AIJob; targetLanguage: string; lipDub: boolean }) {
  const variant = params.lipDub ? "lipsync" : "dub";
  const storageKey = `ai/phase5/${params.aiJob.workspaceId}/${params.aiJob.id}/${variant}/${params.targetLanguage}.mp4`;
  const demoSource = join(process.cwd(), "public", "demo-assets", "demo-portrait.mp4");
  await uploadFileToStorage(storageKey, demoSource, VIDEO_MIME);
  const probe = await probeStorageAsset(storageKey);
  return {
    language: params.targetLanguage,
    storageKey,
    mimeType: VIDEO_MIME,
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height
  };
}

async function applyDubbingSideEffects(aiJob: AIJob, lipDub: boolean) {
  const existing = await prisma.aIOperationResult.findMany({
    where: {
      aiJobId: aiJob.id,
      kind: lipDub ? "phase5_lipsync_track" : "phase5_dubbed_track"
    },
    orderBy: { createdAt: "asc" }
  });

  if (existing.length > 0) {
    return {
      created: false,
      reused: true,
      artifacts: existing.map((item) => ({
        storageKey: item.outputStorageKey,
        ...(typeof item.output === "object" && item.output !== null ? (item.output as Record<string, unknown>) : {})
      }))
    };
  }

  const input = asRecord(aiJob.input);
  const requestedLanguages = asStringArray(input.targetLanguages);
  const targetLanguages = normalizeTargetLanguages(requestedLanguages);
  const sourceLanguage = normalizeLanguage(asString(input.sourceLanguage, "en"));

  if (targetLanguages.length === 0) {
    return {
      created: false,
      sourceLanguage,
      targetLanguages,
      artifacts: [] as Array<Record<string, unknown>>
    };
  }

  const source = await resolveSourceForDubbing({ aiJob, input });
  if (!source) {
    return {
      created: false,
      sourceLanguage,
      targetLanguages,
      artifacts: [] as Array<Record<string, unknown>>,
      reason: "No source media provided"
    };
  }

  const firstLanguage = targetLanguages[0];
  const firstArtifact =
    source.storageKey && source.mimeType.startsWith("video/")
      ? await materializeArtifactFromSource({
          aiJob,
          sourceStorageKey: source.storageKey,
          targetLanguage: firstLanguage,
          lipDub
        })
      : await materializeArtifactFromDemo({ aiJob, targetLanguage: firstLanguage, lipDub });

  const sourceStorageKey = source.storageKey ?? firstArtifact.storageKey;
  const sourceMediaAssetId = await ensureSourceMediaAsset({
    aiJob,
    source: {
      mediaAssetId: source.mediaAssetId,
      storageKey: sourceStorageKey,
      mimeType: source.mimeType || firstArtifact.mimeType,
      durationSec: source.durationSec ?? firstArtifact.durationSec,
      width: source.width ?? firstArtifact.width,
      height: source.height ?? firstArtifact.height,
      sourceType: source.sourceType
    }
  });

  const rest = await Promise.all(
    targetLanguages.slice(1).map(async (language) => {
      if (source.storageKey && source.mimeType.startsWith("video/")) {
        return materializeArtifactFromSource({
          aiJob,
          sourceStorageKey: source.storageKey,
          targetLanguage: language,
          lipDub
        });
      }
      return materializeArtifactFromDemo({ aiJob, targetLanguage: language, lipDub });
    })
  );

  const artifacts = [firstArtifact, ...rest];
  const artifactKind = lipDub ? "LIPSYNC" : "DUBBED";
  const resultKind = lipDub ? "phase5_lipsync_track" : "phase5_dubbed_track";

  await prisma.$transaction(async (tx) => {
    for (const artifact of artifacts) {
      await tx.mediaArtifact.create({
        data: {
          mediaAssetId: sourceMediaAssetId,
          kind: artifactKind,
          storageKey: artifact.storageKey,
          mimeType: artifact.mimeType,
          metadata: {
            language: artifact.language,
            sourceLanguage,
            lipDub,
            aiJobId: aiJob.id,
            legacyProjectId: source.legacyProjectId
          }
        }
      });

      await tx.aIOperationResult.create({
        data: {
          aiJobId: aiJob.id,
          kind: resultKind,
          outputStorageKey: artifact.storageKey,
          output: {
            language: artifact.language,
            sourceLanguage,
            lipDub,
            mimeType: artifact.mimeType,
            durationSec: artifact.durationSec,
            width: artifact.width,
            height: artifact.height,
            mediaArtifactKind: artifactKind
          }
        }
      });
    }
  });

  return {
    created: true,
    sourceLanguage,
    targetLanguages,
    legacyProjectId: source.legacyProjectId,
    sourceStorageKey,
    artifacts
  };
}

export async function applyPhase5SideEffects(aiJob: AIJob) {
  switch (aiJob.type as AIJobType) {
    case "DUBBING":
      return applyDubbingSideEffects(aiJob, false);
    case "LIPSYNC":
      return applyDubbingSideEffects(aiJob, true);
    default:
      return null;
  }
}
