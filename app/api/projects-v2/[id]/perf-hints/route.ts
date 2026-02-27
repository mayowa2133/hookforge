import { buildProjectPerfHints } from "@/lib/desktop/perf";
import { extractDurationMs, summarizeDesktopReliability } from "@/lib/desktop/events";
import { requireProjectContext } from "@/lib/api-context";
import { env } from "@/lib/env";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { buildTimelineState } from "@/lib/timeline-legacy";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await requireProjectContext(params.id);
    const [legacyProject, segmentCount, wordCount, feedbackRows] = await Promise.all([
      prisma.project.findUnique({
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
      }),
      prisma.transcriptSegment.count({
        where: {
          projectId: ctx.projectV2.id
        }
      }),
      prisma.transcriptWord.count({
        where: {
          projectId: ctx.projectV2.id
        }
      }),
      prisma.qualityFeedback.findMany({
        where: {
          workspaceId: ctx.workspace.id,
          projectId: ctx.projectV2.id,
          category: {
            in: [
              "desktop.editor_boot",
              "desktop.command_latency",
              "desktop.app_crash",
              "desktop.native_crash"
            ]
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 400,
        select: {
          category: true,
          metadata: true
        }
      })
    ]);

    if (!legacyProject) {
      throw new Error("Project not found");
    }

    const timeline = buildTimelineState(legacyProject.config, legacyProject.assets as never);
    const trackCount = timeline.tracks.length;
    const clipCount = timeline.tracks.reduce((sum, track) => sum + track.clips.length, 0);
    const hasRenderableMedia = legacyProject.assets.some((asset) => asset.kind === "VIDEO" || asset.kind === "IMAGE");

    const editorOpenDurationsMs: number[] = [];
    const commandDurationsMs: number[] = [];
    for (const row of feedbackRows) {
      const durationMs = extractDurationMs(row.metadata);
      if (durationMs === null) {
        continue;
      }
      if (row.category === "desktop.editor_boot") {
        editorOpenDurationsMs.push(durationMs);
      } else if (row.category === "desktop.command_latency") {
        commandDurationsMs.push(durationMs);
      }
    }
    const reliability = summarizeDesktopReliability(
      feedbackRows.map((row) => ({
        event: row.category.startsWith("desktop.") ? row.category.slice("desktop.".length) : row.category,
        outcome: typeof row.metadata === "object" && row.metadata && "outcome" in row.metadata
          ? (row.metadata as { outcome?: unknown }).outcome as string | null
          : null,
        metadata: row.metadata
      }))
    );
    const largeProjectMode = clipCount >= 280 || wordCount >= 10_000 || segmentCount >= 2_500;

    const perf = buildProjectPerfHints({
      trackCount,
      clipCount,
      segmentCount,
      wordCount,
      hasRenderableMedia,
      editorOpenDurationsMs,
      commandDurationsMs
    });

    return jsonOk({
      projectId: ctx.projectV2.id,
      legacyProjectId: legacyProject.id,
      counts: {
        tracks: trackCount,
        clips: clipCount,
        transcriptSegments: segmentCount,
        transcriptWords: wordCount
      },
      desktopSlo: {
        crashFreeSessionsTargetPct: env.DESCRIPT_PLUS_MIN_DESKTOP_CRASH_FREE_PCT,
        crashFreeSessionsPct: reliability.crashFreeSessionsPct,
        totalSessions: reliability.totalSessions,
        crashSessions: reliability.crashSessions,
        largeProjectMode
      },
      ...perf,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
