import { randomUUID } from "crypto";
import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { appendTimelineRevision } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { applyTimelineOperations, buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";
import type { TimelineOperation } from "@/lib/timeline-types";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const ApplyPresetSchema = z.object({
  presetId: z.string().min(1)
});

function buildPresetOperations(presetId: string, state: ReturnType<typeof buildTimelineState>): TimelineOperation[] {
  const videoTrack = state.tracks.find((track) => track.kind === "VIDEO");
  const firstVideoClip = videoTrack?.clips[0];
  const operations: TimelineOperation[] = [];

  switch (presetId) {
    case "green-screen-commentator":
      if (videoTrack && firstVideoClip) {
        operations.push({
          op: "upsert_effect",
          trackId: videoTrack.id,
          clipId: firstVideoClip.id,
          effectType: "transform",
          config: {
            x: 0.74,
            y: 0.76,
            widthPct: 0.38,
            heightPct: 0.34,
            radius: 24,
            borderWidth: 2
          }
        });
      }
      break;
    case "tweet-comment-popup-reply":
      if (videoTrack && firstVideoClip) {
        operations.push({
          op: "set_transition",
          trackId: videoTrack.id,
          clipId: firstVideoClip.id,
          transitionType: "slide",
          durationMs: 220
        });
      }
      break;
    case "three-beat-montage-intro-main-talk":
      if (videoTrack && firstVideoClip) {
        const firstSplit = firstVideoClip.timelineInMs + 420;
        const secondSplit = firstVideoClip.timelineInMs + 840;
        operations.push({
          op: "split_clip",
          trackId: videoTrack.id,
          clipId: firstVideoClip.id,
          splitMs: firstSplit
        });
        operations.push({
          op: "split_clip",
          trackId: videoTrack.id,
          clipId: firstVideoClip.id,
          splitMs: secondSplit
        });
      }
      break;
    case "split-screen-reaction":
      if (videoTrack && firstVideoClip) {
        operations.push({
          op: "upsert_effect",
          trackId: videoTrack.id,
          clipId: firstVideoClip.id,
          effectType: "transform",
          config: {
            x: 0.5,
            y: 0.28,
            widthPct: 1,
            heightPct: 0.5
          }
        });
      }
      break;
    case "fake-facetime-incoming-call": {
      let audioTrack = state.tracks.find((track) => track.kind === "AUDIO");
      if (!audioTrack) {
        const trackId = randomUUID();
        operations.push({
          op: "create_track",
          trackId,
          kind: "AUDIO",
          name: "Audio Track 1"
        });
        audioTrack = {
          id: trackId,
          kind: "AUDIO",
          name: "Audio Track 1",
          order: state.tracks.length,
          muted: false,
          volume: 1,
          clips: []
        };
      }
      operations.push({
        op: "add_clip",
        trackId: audioTrack.id,
        clipId: randomUUID(),
        slotKey: "library:sfx-ring",
        label: "Incoming call ring",
        timelineInMs: 0,
        durationMs: 1800,
        sourceInMs: 0,
        sourceOutMs: 1800
      });
      break;
    }
    default:
      break;
  }

  return operations;
}

export async function POST(request: Request, { params }: Context) {
  try {
    const body = ApplyPresetSchema.parse(await request.json());
    const ctx = await requireProjectContext(params.id);
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

    const state = buildTimelineState(
      legacyProject.config,
      legacyProject.assets as Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }>
    );
    const operations = buildPresetOperations(body.presetId, state);
    if (operations.length === 0) {
      return jsonOk({
        applied: false,
        reason: "Preset has no applicable operations for current timeline.",
        revisionId: null
      });
    }

    const applied = applyTimelineOperations(state, operations);
    const nextConfig = serializeTimelineState(
      typeof legacyProject.config === "object" && legacyProject.config !== null
        ? (legacyProject.config as Record<string, unknown>)
        : {},
      applied.state
    );

    await prisma.project.update({
      where: { id: legacyProject.id },
      data: {
        config: nextConfig as never
      }
    });

    const revision = await appendTimelineRevision({
      projectId: ctx.projectV2.id,
      createdByUserId: ctx.user.id,
      operations: {
        source: "preset_apply_v2",
        presetId: body.presetId,
        operations
      }
    });

    return jsonOk({
      applied: true,
      presetId: body.presetId,
      operationCount: operations.length,
      revisionId: revision.id
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
