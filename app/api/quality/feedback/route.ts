import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const QualityFeedbackSchema = z.object({
  category: z.string().min(2).max(80),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().min(1).max(2000).optional(),
  projectId: z.string().min(1).optional(),
  aiJobId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional()
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const body = QualityFeedbackSchema.parse(await request.json());

    if (body.projectId) {
      const project = await prisma.projectV2.findFirst({
        where: {
          id: body.projectId,
          workspaceId: workspace.id
        },
        select: { id: true }
      });
      if (!project) {
        throw new Error("Project not found in workspace");
      }
    }

    if (body.aiJobId) {
      const aiJob = await prisma.aIJob.findFirst({
        where: {
          id: body.aiJobId,
          workspaceId: workspace.id
        },
        select: { id: true }
      });
      if (!aiJob) {
        throw new Error("AI job not found in workspace");
      }
    }

    const feedback = await prisma.qualityFeedback.create({
      data: {
        workspaceId: workspace.id,
        projectId: body.projectId,
        aiJobId: body.aiJobId,
        category: body.category,
        rating: body.rating,
        comment: body.comment,
        metadata: body.metadata as Prisma.InputJsonValue | undefined,
        createdByUserId: user.id
      }
    });

    return jsonOk({ feedback }, 201);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
