import { randomUUID } from "crypto";
import { probeStorageAsset } from "@/lib/ffprobe";
import { appendTimelineRevision } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { requireProjectContext } from "@/lib/api-context";
import { getDownloadPresignedUrl } from "@/lib/storage";
import { applyTimelineOperations, buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";
import type { TimelineOperation } from "@/lib/timeline-types";
import { inferAssetKindFromMime } from "@/lib/template-runtime";
import { needsVideoNormalization, normalizeStorageVideoToMp4 } from "@/lib/video-normalize";

type FreeformRegisterInput = {
  projectIdOrV2Id: string;
  storageKey: string;
  mimeType: string;
  originalFileName?: string;
  slot?: "primary" | "broll" | "audio";
  sourceTag?: string;
};

function timelineTrackKindForAsset(kind: "VIDEO" | "IMAGE" | "AUDIO") {
  if (kind === "AUDIO") {
    return "AUDIO" as const;
  }
  return "VIDEO" as const;
}

async function probeWithRetry(storageKey: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await probeStorageAsset(storageKey);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not inspect uploaded media");
}

function addFreeformClipOperation(params: {
  state: ReturnType<typeof buildTimelineState>;
  trackKind: "VIDEO" | "AUDIO";
  assetId: string;
  slotKey: string;
  label: string;
  durationMs: number;
}) {
  const operations: TimelineOperation[] = [];
  let track = params.state.tracks.find((entry) => entry.kind === params.trackKind);

  if (!track) {
    const trackId = randomUUID();
    operations.push({
      op: "create_track",
      trackId,
      kind: params.trackKind,
      name: params.trackKind === "AUDIO" ? "Audio Track 1" : "Video Track 1",
      uiIntent: "system_sync"
    });
    track = {
      id: trackId,
      kind: params.trackKind,
      name: params.trackKind === "AUDIO" ? "Audio Track 1" : "Video Track 1",
      order: params.state.tracks.length,
      muted: false,
      volume: 1,
      clips: []
    };
  }

  const timelineInMs = track.clips.reduce((max, clip) => Math.max(max, clip.timelineOutMs), 0);
  operations.push({
    op: "add_clip",
    clipId: randomUUID(),
    trackId: track.id,
    assetId: params.assetId,
    slotKey: params.slotKey,
    label: params.label,
    timelineInMs,
    durationMs: params.durationMs,
    sourceInMs: 0,
    sourceOutMs: params.durationMs,
    uiIntent: "system_sync"
  });

  return operations;
}

export async function registerProjectV2UploadedMedia(input: FreeformRegisterInput) {
  const ctx = await requireProjectContext(input.projectIdOrV2Id);
  const inferredKind = inferAssetKindFromMime(input.mimeType);
  let finalStorageKey = input.storageKey;
  let finalMimeType = input.mimeType;
  let durationSec: number | null = null;
  let width: number | null = null;
  let height: number | null = null;

  if (inferredKind === "VIDEO" || inferredKind === "AUDIO") {
    const probe = await probeWithRetry(input.storageKey);
    durationSec = probe.durationSec;
    width = probe.width;
    height = probe.height;

    if (inferredKind === "VIDEO" && needsVideoNormalization(input.mimeType, probe)) {
      const normalized = await normalizeStorageVideoToMp4({
        storageKey: input.storageKey,
        projectId: ctx.legacyProject.id,
        slotKey: "freeform"
      });
      finalStorageKey = normalized.storageKey;
      finalMimeType = normalized.mimeType;
      durationSec = normalized.probe.durationSec;
      width = normalized.probe.width;
      height = normalized.probe.height;
    }
  }

  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      source: "UPLOAD",
      storageKey: finalStorageKey,
      mimeType: finalMimeType,
      durationSec,
      width,
      height
    }
  });

  const legacySlotKey = `freeform-${inferredKind.toLowerCase()}-${mediaAsset.id.slice(-8)}`;
  const legacyAsset = await prisma.asset.create({
    data: {
      projectId: ctx.legacyProject.id,
      slotKey: legacySlotKey,
      kind: inferredKind,
      storageKey: finalStorageKey,
      mimeType: finalMimeType,
      durationSec,
      width,
      height
    }
  });

  const legacyProject = await prisma.project.findUnique({
    where: { id: ctx.legacyProject.id },
    select: {
      id: true,
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
  });

  if (!legacyProject) {
    throw new Error("Project not found");
  }

  const timelineState = buildTimelineState(legacyProject.config, legacyProject.assets as never);
  const durationMs = Math.max(1200, Math.floor((durationSec ?? (inferredKind === "IMAGE" ? 4 : 6)) * 1000));
  const operations = addFreeformClipOperation({
    state: timelineState,
    trackKind: timelineTrackKindForAsset(inferredKind),
    assetId: legacyAsset.id,
    slotKey: legacySlotKey,
    label: input.originalFileName ?? inferredKind,
    durationMs
  });

  const applied = applyTimelineOperations(timelineState, operations);
  const nextConfig = serializeTimelineState(
    typeof legacyProject.config === "object" && legacyProject.config !== null
      ? (legacyProject.config as Record<string, unknown>)
      : {},
    applied.state
  );

  await prisma.project.update({
    where: { id: legacyProject.id },
    data: {
      config: nextConfig as never,
      status: "READY"
    }
  });

  await appendTimelineRevision({
    projectId: ctx.projectV2.id,
    createdByUserId: ctx.user.id,
    operations: {
      source: input.sourceTag ?? "media_register_v2",
      operations
    }
  });

  return {
    ctx,
    legacyAsset,
    mediaAsset,
    inferredKind,
    durationSec,
    finalMimeType,
    finalStorageKey,
    response: {
      asset: {
        id: mediaAsset.id,
        slotKey: legacySlotKey,
        kind: inferredKind,
        signedUrl: await getDownloadPresignedUrl(finalStorageKey),
        durationSec,
        mimeType: finalMimeType
      },
      mediaAsset: {
        id: mediaAsset.id,
        storageKey: mediaAsset.storageKey,
        kind: inferredKind,
        mimeType: mediaAsset.mimeType,
        durationSec: mediaAsset.durationSec
      },
      project: {
        id: ctx.projectV2.id,
        status: "READY" as const
      },
      missingSlotKeys: []
    }
  };
}
