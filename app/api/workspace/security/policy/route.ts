import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { ensureWorkspaceSecurityPolicy, sanitizePolicy } from "@/lib/enterprise-security";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { enforceIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const UpdatePolicySchema = z.object({
  enforceSso: z.boolean().optional(),
  allowPasswordAuth: z.boolean().optional(),
  sessionTtlHours: z.number().int().min(1).max(24 * 30).optional(),
  requireMfa: z.boolean().optional(),
  allowedEmailDomains: z.array(z.string().min(2).max(120)).max(50).optional(),
  canaryAllowlist: z.array(z.string().email()).max(200).optional()
});

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "workspace.security.read",
      request
    });
    const policy = await ensureWorkspaceSecurityPolicy(workspace.id);
    return jsonOk({
      workspaceId: workspace.id,
      policy: sanitizePolicy(policy)
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "workspace.security.write",
      request
    });
    await enforceIdempotencyKey({
      request,
      scope: `workspace-security-policy:${workspace.id}`
    });
    const body = UpdatePolicySchema.parse(await request.json());

    const policy = await prisma.workspaceSecurityPolicy.upsert({
      where: {
        workspaceId: workspace.id
      },
      update: {
        ...body,
        updatedByUserId: user.id
      },
      create: {
        workspaceId: workspace.id,
        enforceSso: body.enforceSso ?? false,
        allowPasswordAuth: body.allowPasswordAuth ?? true,
        sessionTtlHours: body.sessionTtlHours ?? 168,
        requireMfa: body.requireMfa ?? false,
        allowedEmailDomains: body.allowedEmailDomains ?? [],
        canaryAllowlist: body.canaryAllowlist ?? [],
        updatedByUserId: user.id
      }
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "workspace_security_policy_update",
      targetType: "WorkspaceSecurityPolicy",
      targetId: policy.id,
      details: {
        enforceSso: policy.enforceSso,
        allowPasswordAuth: policy.allowPasswordAuth,
        sessionTtlHours: policy.sessionTtlHours,
        requireMfa: policy.requireMfa
      }
    });

    return jsonOk({
      workspaceId: workspace.id,
      policy: sanitizePolicy(policy)
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
