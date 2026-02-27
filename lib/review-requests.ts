import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { prisma } from "@/lib/prisma";
import { submitProjectReviewDecision } from "@/lib/review-phase5";
import {
  buildApprovalChainState,
  normalizeApprovalChain,
  type ReviewApprovalRole
} from "@/lib/review-phase5-tools";
import { sanitizeOverlayText } from "@/lib/sanitize";
import { hasWorkspaceCapability, isManagerRole } from "@/lib/workspace-roles";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

const ApprovalChainStepSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  role: z.enum(["OWNER", "ADMIN", "EDITOR"]),
  label: z.string().trim().min(1).max(120).optional(),
  required: z.boolean().optional(),
  order: z.number().int().min(1).max(50).optional()
});

export const ReviewRequestCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  note: z.string().trim().max(2000).optional(),
  requiredScopes: z.array(z.enum(["VIEW", "COMMENT", "APPROVE", "EDIT"])).min(1).max(4).default(["APPROVE"]),
  approvalChain: z.array(ApprovalChainStepSchema).min(1).max(8).optional()
});

export const ReviewRequestDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(2000).optional(),
  requireApproval: z.boolean().optional(),
  approvalChainStepId: z.string().trim().min(1).max(80).optional()
});

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function roleOrder(role: ReviewApprovalRole) {
  if (role === "OWNER") {
    return 3;
  }
  if (role === "ADMIN") {
    return 2;
  }
  return 1;
}

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
  approvalChain?: Array<{
    id?: string;
    role: "OWNER" | "ADMIN" | "EDITOR";
    label?: string;
    required?: boolean;
    order?: number;
  }>;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const membership = await getMembership(ctx.workspace.id, ctx.user.id);
  if (!hasWorkspaceCapability(membership.role, "workspace.projects.write")) {
    throw new Error("Unauthorized");
  }

  const approvalChain = normalizeApprovalChain(params.approvalChain ?? []);

  const request = await prisma.reviewRequest.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      requestedByUserId: ctx.user.id,
      title: sanitizeOverlayText(params.title, "review request"),
      note: params.note ? sanitizeOverlayText(params.note, "review request note") : null,
      requiredScopes: params.requiredScopes,
      metadata: {
        projectTitle: ctx.projectV2.title,
        approvalChain
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
      requiredScopes: request.requiredScopes,
      approvalChainLength: approvalChain.length
    }
  });

  return {
    request: {
      id: request.id,
      status: request.status,
      title: request.title,
      note: request.note,
      requiredScopes: request.requiredScopes,
      approvalChain,
      createdAt: request.createdAt.toISOString()
    }
  };
}

export async function listReviewRequests(params: {
  projectIdOrV2Id: string;
  limit?: number;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const membership = await getMembership(ctx.workspace.id, ctx.user.id);
  if (!hasWorkspaceCapability(membership.role, "workspace.projects.read")) {
    throw new Error("Unauthorized");
  }

  const limit = Math.max(1, Math.min(100, Math.trunc(params.limit ?? 30)));
  const requests = await prisma.reviewRequest.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id
    },
    orderBy: {
      createdAt: "desc"
    },
    take: limit
  });

  const logs = requests.length > 0
    ? await prisma.reviewDecisionLog.findMany({
        where: {
          workspaceId: ctx.workspace.id,
          projectId: ctx.projectV2.id,
          requestId: {
            in: requests.map((entry) => entry.id)
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: limit * 8
      })
    : [];

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    requests: requests.map((request) => {
      const metadata = asRecord(request.metadata);
      const approvalChain = normalizeApprovalChain(metadata.approvalChain);
      const requestLogs = logs
        .filter((log) => log.requestId === request.id)
        .slice(0, 20);
      const chainState = buildApprovalChainState({
        chain: approvalChain,
        decisions: requestLogs.map((log) => ({
          status: log.status,
          metadata: log.metadata,
          decidedByUserId: log.decidedByUserId,
          createdAt: log.createdAt.toISOString()
        }))
      });
      return {
        id: request.id,
        title: request.title,
        note: request.note,
        requiredScopes: request.requiredScopes,
        status: request.status,
        decisionId: request.decisionId,
        decidedAt: request.decidedAt?.toISOString() ?? null,
        decidedByUserId: request.decidedByUserId,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
        approvalChain,
        approvalChainState: chainState,
        logs: requestLogs.map((log) => ({
          id: log.id,
          status: log.status,
          note: log.note,
          decidedByUserId: log.decidedByUserId,
          createdAt: log.createdAt.toISOString(),
          approvalChainStepId: asRecord(log.metadata).approvalChainStepId ?? null
        }))
      };
    })
  };
}

export async function decideReviewRequest(params: {
  projectIdOrV2Id: string;
  requestId: string;
  status: "APPROVED" | "REJECTED";
  note?: string;
  requireApproval?: boolean;
  approvalChainStepId?: string;
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

  const requestMetadata = asRecord(reviewRequest.metadata);
  const approvalChain = normalizeApprovalChain(requestMetadata.approvalChain);
  const decisionLogs = await prisma.reviewDecisionLog.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      requestId: reviewRequest.id
    },
    orderBy: {
      createdAt: "asc"
    },
    take: 50
  });

  const membershipStrength = roleOrder(membership.role as ReviewApprovalRole);
  const unresolvedRequiredStep = approvalChain.find((step) => {
    if (!step.required) {
      return false;
    }
    const stepDecision = decisionLogs.find((log) => asRecord(log.metadata).approvalChainStepId === step.id);
    return !stepDecision;
  }) ?? null;

  const selectedStepId = params.approvalChainStepId ?? unresolvedRequiredStep?.id ?? approvalChain[0]?.id ?? null;
  if (!selectedStepId) {
    throw new Error("Approval chain not configured");
  }

  const selectedStep = approvalChain.find((step) => step.id === selectedStepId) ?? null;
  if (!selectedStep) {
    throw new Error("Approval chain step not found");
  }

  if (membershipStrength < roleOrder(selectedStep.role)) {
    throw new Error("Unauthorized");
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
        decisionId: decision.decision.id,
        approvalChainStepId: selectedStep.id,
        approvalChainRole: selectedStep.role
      }
    }
  });

  const chainState = buildApprovalChainState({
    chain: approvalChain,
    decisions: [...decisionLogs, log].map((entry) => ({
      status: entry.status,
      metadata: entry.metadata,
      decidedByUserId: entry.decidedByUserId,
      createdAt: entry.createdAt.toISOString()
    }))
  });

  const finalStatus = params.status === "REJECTED"
    ? "REJECTED"
    : chainState.isComplete
      ? "APPROVED"
      : "PENDING";
  const finalDecisionId = finalStatus === "PENDING" ? reviewRequest.decisionId : decision.decision.id;

  const updatedRequest = await prisma.reviewRequest.update({
    where: {
      id: reviewRequest.id
    },
    data: {
      status: finalStatus,
      decisionId: finalDecisionId,
      decidedAt: finalStatus === "PENDING" ? null : new Date(),
      decidedByUserId: finalStatus === "PENDING" ? null : ctx.user.id
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
      requestStatus: updatedRequest.status,
      reviewDecisionLogId: log.id,
      approvalChainStepId: selectedStep.id,
      approvalChainState: {
        isComplete: chainState.isComplete,
        nextRequiredStepId: chainState.nextRequiredStepId,
        completedRequiredCount: chainState.completedRequiredCount,
        totalRequiredCount: chainState.totalRequiredCount
      }
    }
  });

  return {
    request: {
      id: updatedRequest.id,
      status: updatedRequest.status,
      decisionId: updatedRequest.decisionId,
      decidedAt: updatedRequest.decidedAt?.toISOString() ?? null,
      decidedByUserId: updatedRequest.decidedByUserId,
      approvalChainState: chainState
    },
    decision,
    logId: log.id,
    approvalChainStepId: selectedStep.id
  };
}
