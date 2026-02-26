import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { prisma } from "@/lib/prisma";
import { submitProjectReviewDecision } from "@/lib/review-phase5";
import { sanitizeOverlayText } from "@/lib/sanitize";
import { hasWorkspaceCapability, isManagerRole } from "@/lib/workspace-roles";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const ReviewRequestCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  note: z.string().trim().max(2000).optional(),
  requiredScopes: z.array(z.enum(["VIEW", "COMMENT", "APPROVE", "EDIT"])).min(1).max(4).default(["APPROVE"])
});

export const ReviewRequestDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(2000).optional(),
  requireApproval: z.boolean().optional()
});

async function getMembership(workspaceId: string, userId: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId
      }
    }
  });
  if (!membership) {
    throw new Error("Unauthorized");
  }
  return membership;
}

export async function createReviewRequest(params: {
  projectIdOrV2Id: string;
  title: string;
  note?: string;
  requiredScopes: Array<"VIEW" | "COMMENT" | "APPROVE" | "EDIT">;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const membership = await getMembership(ctx.workspace.id, ctx.user.id);
  if (!hasWorkspaceCapability(membership.role, "workspace.projects.write")) {
    throw new Error("Unauthorized");
  }

  const request = await prisma.reviewRequest.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      requestedByUserId: ctx.user.id,
      title: sanitizeOverlayText(params.title, "review request"),
      note: params.note ? sanitizeOverlayText(params.note, "review request note") : null,
      requiredScopes: params.requiredScopes,
      metadata: {
        projectTitle: ctx.projectV2.title
      }
    }
  });

  await recordWorkspaceAuditEvent({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: "review.request.create",
    targetType: "review_request",
    targetId: request.id,
    details: {
      projectId: ctx.projectV2.id,
      requiredScopes: request.requiredScopes
    }
  });

  return {
    request: {
      id: request.id,
      status: request.status,
      title: request.title,
      note: request.note,
      requiredScopes: request.requiredScopes,
      createdAt: request.createdAt.toISOString()
    }
  };
}

export async function decideReviewRequest(params: {
  projectIdOrV2Id: string;
  requestId: string;
  status: "APPROVED" | "REJECTED";
  note?: string;
  requireApproval?: boolean;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const membership = await getMembership(ctx.workspace.id, ctx.user.id);
  if (!isManagerRole(membership.role)) {
    throw new Error("Unauthorized");
  }

  const reviewRequest = await prisma.reviewRequest.findFirst({
    where: {
      id: params.requestId,
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id
    }
  });
  if (!reviewRequest) {
    throw new Error("Review request not found");
  }

  const decision = await submitProjectReviewDecision({
    projectIdOrV2Id: ctx.projectV2.id,
    status: params.status,
    note: params.note,
    requireApproval: params.requireApproval ?? true
  });

  const log = await prisma.reviewDecisionLog.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      requestId: reviewRequest.id,
      decidedByUserId: ctx.user.id,
      status: params.status,
      note: params.note ? sanitizeOverlayText(params.note, "review decision note") : null,
      metadata: {
        decisionId: decision.decision.id
      }
    }
  });

  const updatedRequest = await prisma.reviewRequest.update({
    where: {
      id: reviewRequest.id
    },
    data: {
      status: params.status,
      decisionId: decision.decision.id,
      decidedAt: new Date(),
      decidedByUserId: ctx.user.id
    }
  });

  await recordWorkspaceAuditEvent({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: "review.request.decision",
    targetType: "review_request",
    targetId: updatedRequest.id,
    details: {
      decisionStatus: params.status,
      reviewDecisionLogId: log.id
    }
  });

  return {
    request: {
      id: updatedRequest.id,
      status: updatedRequest.status,
      decisionId: updatedRequest.decisionId,
      decidedAt: updatedRequest.decidedAt?.toISOString() ?? null,
      decidedByUserId: updatedRequest.decidedByUserId
    },
    decision,
    logId: log.id
  };
}
