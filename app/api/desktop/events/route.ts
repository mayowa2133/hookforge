import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireProjectContext, requireUserWithWorkspace } from "@/lib/api-context";
import { requireCurrentUser } from "@/lib/auth";
import { DesktopEventNames } from "@/lib/desktop/events";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const DesktopEventSchema = z.object({
  projectId: z.string().min(1).optional(),
  event: z.enum(DesktopEventNames),
  outcome: z.enum(["SUCCESS", "ERROR", "INFO"]).default("INFO"),
  durationMs: z.number().int().min(0).max(60_000).optional(),
  metadata: z.record(z.unknown()).optional()
});

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

    const entry = await prisma.qualityFeedback.create({
      data: {
        workspaceId,
        projectId: projectV2Id,
        category: `desktop.${body.event}`,
        comment: body.outcome,
        metadata: {
          outcome: body.outcome,
          durationMs: body.durationMs ?? null,
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
