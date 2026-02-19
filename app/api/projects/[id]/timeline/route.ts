import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  applyTimelineOperations,
  buildTimelineState, serializeTimelineState
} from "@/lib/timeline-legacy";
import type { TimelineOperation } from "@/lib/timeline-types";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const TrackKindSchema = z.enum(["VIDEO", "AUDIO", "CAPTION"]);
const PresetSchema = z.enum(["tiktok_9x16", "reels_9x16", "youtube_shorts_9x16", "custom"]);

const TimelineOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create_track"),
    trackId: z.string().min(1).optional(),
    kind: TrackKindSchema,
    name: z.string().min(1).max(120)
  }),
  z.object({
    op: z.literal("add_clip"),
    clipId: z.string().min(1).optional(),
    trackId: z.string().min(1),
    label: z.string().max(160).optional(),
    assetId: z.string().optional(),
    slotKey: z.string().optional(),
    timelineInMs: z.number().int().min(0),
    durationMs: z.number().int().min(120),
    sourceInMs: z.number().int().min(0).optional(),
    sourceOutMs: z.number().int().min(0).optional()
  }),
  z.object({ op: z.literal("split_clip"), trackId: z.string().min(1), clipId: z.string().min(1), splitMs: z.number().int().min(1) }),
  z.object({
    op: z.literal("trim_clip"),
    trackId: z.string().min(1),
    clipId: z.string().min(1),
    trimStartMs: z.number().int().min(0).optional(),
    trimEndMs: z.number().int().min(0).optional()
  }),
  z.object({ op: z.literal("reorder_track"), trackId: z.string().min(1), order: z.number().int().min(0) }),
  z.object({
    op: z.literal("remove_clip"),
    trackId: z.string().min(1),
    clipId: z.string().min(1)
  }),
  z.object({
    op: z.literal("move_clip"),
    trackId: z.string().min(1),
    clipId: z.string().min(1),
    timelineInMs: z.number().int().min(0)
  }),
  z.object({
    op: z.literal("set_clip_timing"),
    trackId: z.string().min(1),
    clipId: z.string().min(1),
    timelineInMs: z.number().int().min(0),
    durationMs: z.number().int().min(120)
  }),
  z.object({
    op: z.literal("merge_clip_with_next"),
    trackId: z.string().min(1),
    clipId: z.string().min(1)
  }),
  z.object({
    op: z.literal("set_clip_label"),
    trackId: z.string().min(1),
    clipId: z.string().min(1),
    label: z.string().min(1).max(160)
  }),
  z.object({
    op: z.literal("set_track_audio"),
    trackId: z.string().min(1),
    volume: z.number().min(0).max(1.5).optional(),
    muted: z.boolean().optional()
  }),
  z.object({
    op: z.literal("add_effect"),
    trackId: z.string().min(1),
    clipId: z.string().min(1),
    effectType: z.string().min(1).max(80),
    config: z.record(z.unknown()).optional()
  }),
  z.object({
    op: z.literal("upsert_effect"),
    trackId: z.string().min(1),
    clipId: z.string().min(1),
    effectType: z.string().min(1).max(80),
    config: z.record(z.unknown()).optional()
  }),
  z.object({
    op: z.literal("set_transition"),
    trackId: z.string().min(1),
    clipId: z.string().min(1),
    transitionType: z.enum(["cut", "crossfade", "slide"]),
    durationMs: z.number().int().min(40).max(4000)
  }),
  z.object({
    op: z.literal("set_keyframe"),
    trackId: z.string().min(1),
    clipId: z.string().min(1),
    effectId: z.string().min(1),
    property: z.string().min(1).max(80),
    timeMs: z.number().int().min(0),
    value: z.union([z.string(), z.number(), z.boolean()]),
    easing: z.string().max(40).optional()
  }),
  z.object({
    op: z.literal("set_export_preset"),
    preset: PresetSchema,
    width: z.number().int().min(120).optional(),
    height: z.number().int().min(120).optional()
  })
]);

const TimelinePatchSchema = z.object({
  operations: z.array(TimelineOperationSchema).min(1)
});

async function requireProject(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: {
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

  if (!project) {
    throw new Error("Project not found");
  }

  return project;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Failed to apply timeline patch";
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const project = await requireProject(params.id, user.id);
    const state = buildTimelineState(project.config, project.assets as never);

    return NextResponse.json({
      timeline: state,
      revisionId: state.revisions[0]?.id ?? null,
      revision: state.version,
      timelineHash: state.revisions[0]?.timelineHash ?? null
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = TimelinePatchSchema.parse(await request.json());
    const project = await requireProject(params.id, user.id);

    const state = buildTimelineState(project.config, project.assets as never);
    const applied = applyTimelineOperations(state, body.operations as TimelineOperation[]);

    const currentConfig = typeof project.config === "object" && project.config !== null
      ? (project.config as Record<string, unknown>)
      : {};

    const updatedConfig = serializeTimelineState(currentConfig, applied.state);

    await prisma.project.update({
      where: { id: project.id },
      data: {
        config: updatedConfig as never
      }
    });

    return NextResponse.json({
      revisionId: applied.state.revisions[0]?.id ?? null,
      timelineHash: applied.timelineHash,
      revision: applied.revision,
      timeline: applied.state
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Track not found")) {
      return NextResponse.json({ error: toErrorMessage(error) }, { status: 404 });
    }
    if (error instanceof Error && error.message.startsWith("Clip not found")) {
      return NextResponse.json({ error: toErrorMessage(error) }, { status: 404 });
    }
    return routeErrorToResponse(error);
  }
}
