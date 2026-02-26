import { requireProjectContext } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getQueueHealth } from "@/lib/ops";
import { buildDescriptPlusLaunchReadiness } from "@/lib/parity/launch-readiness";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

function summarizeStatus(params: {
  queueHealthy: boolean;
  hasRenderableMedia: boolean;
  legacyStatus: string;
  projectV2Status: string;
}) {
  if (!params.queueHealthy) {
    return "DEGRADED" as const;
  }
  if (!params.hasRenderableMedia) {
    return "WAITING_MEDIA" as const;
  }
  if (params.legacyStatus === "ERROR" || params.projectV2Status === "ERROR") {
    return "ERROR" as const;
  }
  return "HEALTHY" as const;
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await requireProjectContext(params.id);
    const [legacyProject, queueHealth, recentRenderJobs, recentAiJobs, launchReadiness] = await Promise.all([
      prisma.project.findUnique({
        where: { id: ctx.legacyProject.id },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          assets: {
            select: {
              id: true,
              kind: true
            }
          }
        }
      }),
      getQueueHealth(),
      prisma.renderJob.findMany({
        where: {
          projectId: ctx.legacyProject.id
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          status: true,
          progress: true,
          createdAt: true,
          updatedAt: true,
          errorMessage: true
        }
      }),
      prisma.aIJob.findMany({
        where: {
          projectId: ctx.projectV2.id
        },
        orderBy: { createdAt: "desc" },
        take: 12,
        select: {
          id: true,
          type: true,
          status: true,
          progress: true,
          createdAt: true,
          updatedAt: true,
          errorMessage: true
        }
      }),
      buildDescriptPlusLaunchReadiness({
        workspaceId: ctx.workspace.id,
        userEmail: ctx.user.email,
        persistIncident: false
      })
    ]);

    if (!legacyProject) {
      throw new Error("Project not found");
    }

    const hasRenderableMedia = legacyProject.assets.some((asset) => asset.kind === "VIDEO" || asset.kind === "IMAGE");
    const syncStatus = legacyProject.status === ctx.projectV2.status ? "IN_SYNC" : "DRIFT";
    const status = summarizeStatus({
      queueHealthy: queueHealth.healthy,
      hasRenderableMedia,
      legacyStatus: legacyProject.status,
      projectV2Status: ctx.projectV2.status
    });

    return jsonOk({
      projectId: ctx.projectV2.id,
      legacyProjectId: legacyProject.id,
      status,
      syncStatus,
      hasRenderableMedia,
      queue: {
        healthy: queueHealth.healthy,
        queues: queueHealth.queues
      },
      render: {
        readiness: hasRenderableMedia ? "READY" : "BLOCKED",
        latest: recentRenderJobs[0] ?? null,
        recent: recentRenderJobs
      },
      ai: {
        latest: recentAiJobs[0] ?? null,
        recent: recentAiJobs
      },
      guardrails: {
        stage: launchReadiness.stage,
        status: launchReadiness.guardrails.status,
        shouldRollback: launchReadiness.guardrails.shouldRollback,
        triggers: launchReadiness.guardrails.triggers,
        parityScore: launchReadiness.scorecard.overallScore,
        renderSuccessPct: launchReadiness.snapshot.renderSuccessPct,
        aiSuccessPct: launchReadiness.snapshot.aiSuccessPct,
        queueBacklog: launchReadiness.snapshot.queueBacklog,
        queueFailed: launchReadiness.snapshot.queueFailed
      },
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
