import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { normalizePublicApiScopes } from "@/lib/enterprise-security";
import { jsonError, jsonOk, routeErrorToResponse } from "@/lib/http";
import { enforceIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

type Context = {
  params: {
    id: string;
  };
};

const ScopeSchema = z.object({
  scopes: z.array(z.string().min(2).max(80)).min(1).max(30),
  rateLimitPerMinute: z.number().int().min(10).max(5000).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "api_keys.manage",
      request
    });
    await enforceIdempotencyKey({
      request,
      scope: `api-key-scopes:${workspace.id}:${params.id}`
    });
    const body = ScopeSchema.parse(await request.json());
    const scopes = normalizePublicApiScopes(body.scopes);

    const existing = await prisma.publicApiKey.findFirst({
      where: {
        id: params.id,
        workspaceId: workspace.id
      }
    });

    if (!existing) {
      return jsonError("API key not found", 404);
    }

    const updated = await prisma.publicApiKey.update({
      where: {
        id: existing.id
      },
      data: {
        scopes,
        ...(body.rateLimitPerMinute !== undefined ? { rateLimitPerMinute: body.rateLimitPerMinute } : {})
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        status: true,
        scopes: true,
        rateLimitPerMinute: true,
        expiresAt: true,
        lastRotationAt: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "api_key_scopes_update",
      targetType: "PublicApiKey",
      targetId: updated.id,
      details: {
        scopes: updated.scopes,
        rateLimitPerMinute: updated.rateLimitPerMinute
      }
    });

    return jsonOk({
      apiKey: updated
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
