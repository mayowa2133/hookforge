import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const SegmentABSchema = z.object({
  runId: z.string().min(1).optional(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
  language: z.string().trim().min(2).max(12).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = SegmentABSchema.parse(await request.json());
    const ctx = await requireProjectContext(params.id);
    const run = body.runId
      ? await prisma.audioEnhancementRun.findFirst({
          where: {
            id: body.runId,
            workspaceId: ctx.workspace.id,
            projectId: ctx.projectV2.id
          }
        })
      : await prisma.audioEnhancementRun.findFirst({
          where: {
            workspaceId: ctx.workspace.id,
            projectId: ctx.projectV2.id,
            status: {
              in: ["PREVIEWED", "APPLIED"]
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        });

    const startMs = Math.min(body.startMs, body.endMs);
    const endMs = Math.max(body.startMs, body.endMs);

    return jsonOk({
      projectId: ctx.legacyProject.id,
      projectV2Id: ctx.projectV2.id,
      language: body.language?.trim().toLowerCase() ?? "en",
      segment: {
        startMs,
        endMs
      },
      run: run
        ? {
            id: run.id,
            operation: run.operation,
            mode: run.mode,
            status: run.status,
            createdAt: run.createdAt.toISOString()
          }
        : null,
      audition: {
        beforeLabel: "Original",
        afterLabel: "Enhanced",
        supported: true,
        note: "AB segment audition is metadata-backed in this MVP and reuses timeline preview for before/after verification."
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
