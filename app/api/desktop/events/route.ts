import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireProjectContext, requireUserWithWorkspace } from "@/lib/api-context";
import { requireCurrentUser } from "@/lib/auth";
import {
  DesktopEventNames,
  normalizeDesktopClientVersion
} from "@/lib/desktop/events";
import { DesktopPlatforms, DesktopReleaseChannels } from "@/lib/desktop/releases";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const DesktopEventSchema = z.object({
  projectId: z.string().min(1).optional(),
  event: z.enum(DesktopEventNames),
  outcome: z.enum(["SUCCESS", "ERROR", "INFO"]).default("INFO"),
  durationMs: z.number().int().min(0).max(60_000).optional(),
  sessionId: z.string().trim().min(1).max(120).optional(),
  clientVersion: z.string().trim().min(1).max(64).optional(),
  channel: z.enum(DesktopReleaseChannels).optional(),
  platform: z.enum(DesktopPlatforms).optional(),
  metadata: z.record(z.unknown()).optional()
});

function isCrashEvent(event: z.infer<typeof DesktopEventSchema>["event"]) {
  return event === "app_crash" || event === "native_crash";
}

export async function POST(request: Request) {
  try {
    const body = DesktopEventSchema.parse(await request.json());
    const user = await requireCurrentUser();
    let workspaceId: string;
    let projectV2Id: string | null = null;

    if (body.projectId) {
      const scope = await requireProjectContext(body.projectId);
      if (scope.user.id !== user.id) {
        throw new Error("Unauthorized");
      }
      workspaceId = scope.workspace.id;
      projectV2Id = scope.projectV2.id;
    } else {
      const scope = await requireUserWithWorkspace();
      if (scope.user.id !== user.id) {
        throw new Error("Unauthorized");
      }
      workspaceId = scope.workspace.id;
    }

    const normalizedClientVersion = normalizeDesktopClientVersion(body.clientVersion);
    const outcome = isCrashEvent(body.event)
      ? "ERROR"
      : body.outcome;

    const entry = await prisma.qualityFeedback.create({
      data: {
        workspaceId,
        projectId: projectV2Id,
        category: `desktop.${body.event}`,
        comment: outcome,
        metadata: {
          outcome,
          durationMs: body.durationMs ?? null,
          sessionId: body.sessionId ?? null,
          clientVersion: normalizedClientVersion,
          channel: body.channel ?? null,
          platform: body.platform ?? null,
          ...(body.metadata ?? {})
        } as Prisma.InputJsonObject,
        createdByUserId: user.id
      },
      select: {
        id: true,
        createdAt: true
      }
    });

    return jsonOk({
      tracked: true,
      eventId: entry.id,
      createdAt: entry.createdAt.toISOString()
    }, 201);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
