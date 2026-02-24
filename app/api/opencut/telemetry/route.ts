import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { OpenCutEventNames } from "@/lib/opencut/metrics";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const TelemetrySchema = z.object({
  projectId: z.string().min(1),
  event: z.enum(OpenCutEventNames),
  outcome: z.enum(["SUCCESS", "ERROR", "INFO"]).default("INFO"),
  metadata: z.record(z.unknown()).optional()
});

export async function POST(request: Request) {
  try {
    const body = TelemetrySchema.parse(await request.json());
    const ctx = await requireProjectContext(body.projectId);

    const entry = await prisma.qualityFeedback.create({
      data: {
        workspaceId: ctx.workspace.id,
        projectId: ctx.projectV2.id,
        category: `opencut.${body.event}`,
        comment: body.outcome,
        metadata: {
          outcome: body.outcome,
          ...(body.metadata ?? {})
        } as Prisma.InputJsonObject,
        createdByUserId: ctx.user.id
      },
      select: {
        id: true,
        createdAt: true
      }
    });

    return jsonOk({ tracked: true, eventId: entry.id, createdAt: entry.createdAt.toISOString() }, 201);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
