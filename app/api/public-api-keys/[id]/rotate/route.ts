import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { jsonError, jsonOk, routeErrorToResponse } from "@/lib/http";
import { enforceIdempotencyKey } from "@/lib/idempotency";
import { generateApiKey, hashApiKey, makeApiKeyPrefix } from "@/lib/public-api";
import { prisma } from "@/lib/prisma";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

type Context = {
  params: {
    id: string;
  };
};

const RotateSchema = z.object({
  overlapMinutes: z.number().int().min(0).max(24 * 60).default(15),
  revokePreviousImmediately: z.boolean().default(false)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "api_keys.manage",
      request
    });
    await enforceIdempotencyKey({
      request,
      scope: `api-key-rotate:${workspace.id}:${params.id}`
    });
    const body = RotateSchema.parse(await request.json().catch(() => ({})));

    const current = await prisma.publicApiKey.findFirst({
      where: {
        id: params.id,
        workspaceId: workspace.id
      }
    });

    if (!current) {
      return jsonError("API key not found", 404);
    }

    if (current.status !== "ACTIVE") {
      return jsonError("Only active keys can be rotated", 400);
    }

    const now = new Date();
    const overlapMinutes = body.revokePreviousImmediately ? 0 : body.overlapMinutes;
    const overlapUntil = overlapMinutes > 0 ? new Date(now.getTime() + overlapMinutes * 60 * 1000) : null;
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = makeApiKeyPrefix(rawKey);

    const { previous, rotated } = await prisma.$transaction(async (tx) => {
      const previousUpdated = await tx.publicApiKey.update({
        where: {
          id: current.id
        },
        data: {
          status: overlapUntil ? "ACTIVE" : "DISABLED",
          expiresAt: overlapUntil,
          lastRotationAt: now
        }
      });

      const nextKey = await tx.publicApiKey.create({
        data: {
          workspaceId: workspace.id,
          createdByUserId: user.id,
          name: `${current.name} (rotated ${now.toISOString().slice(0, 10)})`,
          keyPrefix,
          keyHash,
          status: "ACTIVE",
          scopes: current.scopes,
          rateLimitPerMinute: current.rateLimitPerMinute,
          expiresAt: current.expiresAt,
          rotatedFromKeyId: current.id,
          lastRotationAt: now
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

      return { previous: previousUpdated, rotated: nextKey };
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "api_key_rotate",
      targetType: "PublicApiKey",
      targetId: rotated.id,
      details: {
        previousKeyId: previous.id,
        overlapMinutes,
        overlapUntil
      }
    });

    return jsonOk({
      apiKey: rotated,
      secret: rawKey,
      previousKey: {
        id: previous.id,
        status: previous.status,
        expiresAt: previous.expiresAt
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
