import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { routeErrorToResponse } from "@/lib/http";
import { applyTimelineOperations, buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";
import type { TimelineOperation } from "@/lib/timeline-types";
import { validateTimelineStateInvariants } from "@/lib/timeline-invariants";
import { prisma } from "@/lib/prisma";
import { appendTimelineRevision } from "@/lib/project-v2";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const TrackKindSchema = z.enum(["VIDEO", "AUDIO", "CAPTION"]);
const PresetSchema = z.enum(["tiktok_9x16", "reels_9x16", "youtube_shorts_9x16", "custom"]);

const TimelineOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create_track"), trackId: z.string().min(1).optional(), kind: TrackKindSchema, name: z.string().min(1).max(120) }),
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
  z.object({ op: z.literal("trim_clip"), trackId: z.string().min(1), clipId: z.string().min(1), trimStartMs: z.number().int().min(0).optional(), trimEndMs: z.number().int().min(0).optional() }),
  z.object({ op: z.literal("reorder_track"), trackId: z.string().min(1), order: z.number().int().min(0) }),
  z.object({ op: z.literal("remove_clip"), trackId: z.string().min(1), clipId: z.string().min(1) }),
  z.object({ op: z.literal("move_clip"), trackId: z.string().min(1), clipId: z.string().min(1), timelineInMs: z.number().int().min(0) }),
  z.object({ op: z.literal("set_clip_timing"), trackId: z.string().min(1), clipId: z.string().min(1), timelineInMs: z.number().int().min(0), durationMs: z.number().int().min(120) }),
  z.object({ op: z.literal("merge_clip_with_next"), trackId: z.string().min(1), clipId: z.string().min(1) }),
  z.object({ op: z.literal("set_clip_label"), trackId: z.string().min(1), clipId: z.string().min(1), label: z.string().min(1).max(160) }),
  z.object({ op: z.literal("set_track_audio"), trackId: z.string().min(1), volume: z.number().min(0).max(1.5).optional(), muted: z.boolean().optional() }),
  z.object({ op: z.literal("add_effect"), trackId: z.string().min(1), clipId: z.string().min(1), effectType: z.string().min(1).max(80), config: z.record(z.unknown()).optional() }),
  z.object({ op: z.literal("upsert_effect"), trackId: z.string().min(1), clipId: z.string().min(1), effectType: z.string().min(1).max(80), config: z.record(z.unknown()).optional() }),
  z.object({ op: z.literal("set_transition"), trackId: z.string().min(1), clipId: z.string().min(1), transitionType: z.enum(["cut", "crossfade", "slide"]), durationMs: z.number().int().min(40).max(4000) }),
  z.object({ op: z.literal("set_keyframe"), trackId: z.string().min(1), clipId: z.string().min(1), effectId: z.string().min(1), property: z.string().min(1).max(80), timeMs: z.number().int().min(0), value: z.union([z.string(), z.number(), z.boolean()]), easing: z.string().max(40).optional() }),
  z.object({ op: z.literal("set_export_preset"), preset: PresetSchema, width: z.number().int().min(120).optional(), height: z.number().int().min(120).optional() })
]);

const TimelinePatchSchema = z.object({
  operations: z.array(TimelineOperationSchema).min(1)
});

function timelineStateFromLegacyProject(project: { config: unknown; assets: Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }> }) {
  return buildTimelineState(project.config, project.assets as never);
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await requireProjectContext(params.id);
    const legacyProject = await prisma.project.findUnique({
      where: { id: ctx.legacyProject.id },
      select: {
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
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const state = timelineStateFromLegacyProject(legacyProject);
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
    const body = TimelinePatchSchema.parse(await request.json());
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
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const state = timelineStateFromLegacyProject(legacyProject);
    const applied = applyTimelineOperations(state, body.operations as TimelineOperation[]);
    const invariantIssues = validateTimelineStateInvariants(applied.state);
    if (invariantIssues.length > 0) {
      return NextResponse.json({ error: "Timeline invariant validation failed", issues: invariantIssues }, { status: 400 });
    }

    const currentConfig = typeof legacyProject.config === "object" && legacyProject.config !== null
      ? (legacyProject.config as Record<string, unknown>)
      : {};
    const updatedConfig = serializeTimelineState(currentConfig, applied.state);

    await prisma.project.update({
      where: { id: legacyProject.id },
      data: {
        config: updatedConfig as never
      }
    });

    await appendTimelineRevision({
      projectId: ctx.projectV2.id,
      createdByUserId: ctx.user.id,
      operations: {
        source: "timeline_patch_v2",
        operations: body.operations
      }
    });

    return NextResponse.json({
      revisionId: applied.state.revisions[0]?.id ?? null,
      timelineHash: applied.timelineHash,
      revision: applied.revision,
      timeline: applied.state
    }, { status: 201 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
