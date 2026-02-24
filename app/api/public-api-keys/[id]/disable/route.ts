import { requireWorkspaceCapability } from "@/lib/api-context";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { enforceIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

type Context = {
  params: {
    id: string;
  };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "api_keys.manage",
      request
    });
    await enforceIdempotencyKey({
      request,
      scope: `api-key-disable:${workspace.id}:${params.id}`,
      required: false
    });
    const apiKey = await prisma.publicApiKey.findFirst({
      where: {
        id: params.id,
        workspaceId: workspace.id
      }
    });

    if (!apiKey) {
      return jsonError("API key not found", 404);
    }

    const updated = await prisma.publicApiKey.update({
      where: { id: apiKey.id },
      data: { status: "DISABLED" },
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
      action: "api_key_disable",
      targetType: "PublicApiKey",
      targetId: updated.id
    });

    return jsonOk({
      apiKey: updated
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
