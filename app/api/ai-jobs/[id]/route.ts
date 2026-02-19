import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const QuerySchema = z.object({
  includeTrace: z.coerce.boolean().default(true)
});

export async function GET(request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return jsonError("Unauthorized", 401);
    }

    const url = new URL(request.url);
    const query = QuerySchema.parse({
      includeTrace: url.searchParams.get("includeTrace") ?? "true"
    });

    const aiJob = await prisma.aIJob.findUnique({
      where: {
        id: params.id
      },
      include: {
        project: {
          select: {
            id: true,
            legacyProjectId: true
          }
        },
        providerRuns: query.includeTrace
          ? {
              orderBy: { createdAt: "desc" },
              take: 5
            }
          : false,
        results: query.includeTrace
          ? {
              orderBy: { createdAt: "desc" },
              take: 5
            }
          : false
      }
    });

    if (!aiJob || !aiJob.project?.legacyProjectId) {
      return jsonError("Job not found", 404);
    }

    const project = await prisma.project.findFirst({
      where: {
        id: aiJob.project.legacyProjectId,
        userId: user.id
      },
      select: {
        id: true
      }
    });

    if (!project) {
      return jsonError("Job not found", 404);
    }

    return jsonOk({
      aiJob: {
        id: aiJob.id,
        projectId: project.id,
        type: aiJob.type,
        status: aiJob.status,
        progress: aiJob.progress,
        input: aiJob.input,
        output: aiJob.output,
        errorMessage: aiJob.errorMessage,
        createdAt: aiJob.createdAt,
        updatedAt: aiJob.updatedAt,
        providerRuns: aiJob.providerRuns,
        results: aiJob.results
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
