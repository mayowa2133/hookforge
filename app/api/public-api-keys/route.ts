import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { generateApiKey, hashApiKey, makeApiKeyPrefix } from "@/lib/public-api";
import { normalizePublicApiScopes } from "@/lib/enterprise-security";
import { prisma } from "@/lib/prisma";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const CreateApiKeySchema = z.object({
  name: z.string().min(2).max(80),
  scopes: z.array(z.string().min(2).max(80)).max(30).optional(),
  rateLimitPerMinute: z.number().int().min(10).max(5000).optional(),
  expiresInDays: z.number().int().min(1).max(730).optional()
});

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "api_keys.read",
      request
    });
    const apiKeys = await prisma.publicApiKey.findMany({
      where: {
        workspaceId: workspace.id
      },
      orderBy: {
        createdAt: "desc"
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

    return jsonOk({
      workspaceId: workspace.id,
      apiKeys
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "api_keys.manage",
      request
    });
    const body = CreateApiKeySchema.parse(await request.json());

    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = makeApiKeyPrefix(rawKey);
    const scopes = normalizePublicApiScopes(body.scopes);
    const expiresAt = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000) : null;

    const apiKey = await prisma.publicApiKey.create({
      data: {
        workspaceId: workspace.id,
        createdByUserId: user.id,
        name: body.name.trim(),
        keyPrefix,
        keyHash,
        status: "ACTIVE",
        scopes,
        rateLimitPerMinute: body.rateLimitPerMinute ?? 120,
        expiresAt
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
      action: "api_key_create",
      targetType: "PublicApiKey",
      targetId: apiKey.id,
      details: {
        scopes,
        rateLimitPerMinute: apiKey.rateLimitPerMinute,
        expiresAt: apiKey.expiresAt
      }
    });

    return jsonOk(
      {
        workspaceId: workspace.id,
        apiKey,
        secret: rawKey
      },
      201
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
