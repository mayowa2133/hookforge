import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { serializeIdentityProvider } from "@/lib/enterprise-security";
import { jsonError, jsonOk, routeErrorToResponse } from "@/lib/http";
import { enforceIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secret-box";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

type Context = {
  params: {
    id: string;
  };
};

const UpdateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  issuerUrl: z.string().url().nullable().optional(),
  clientId: z.string().min(2).max(240).nullable().optional(),
  clientSecret: z.string().min(2).max(2000).nullable().optional(),
  authorizationEndpoint: z.string().url().nullable().optional(),
  tokenEndpoint: z.string().url().nullable().optional(),
  jwksUri: z.string().url().nullable().optional(),
  samlMetadataXml: z.string().min(10).max(200000).nullable().optional(),
  samlEntityId: z.string().min(2).max(400).nullable().optional(),
  samlSsoUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().optional()
});

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "workspace.security.write",
      request
    });
    await enforceIdempotencyKey({
      request,
      scope: `workspace-sso-provider-update:${workspace.id}:${params.id}`
    });
    const body = UpdateSchema.parse(await request.json());

    const existing = await prisma.identityProviderConfig.findFirst({
      where: {
        id: params.id,
        workspaceId: workspace.id
      }
    });

    if (!existing) {
      return jsonError("SSO provider not found", 404);
    }

    const provider = await prisma.identityProviderConfig.update({
      where: {
        id: existing.id
      },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.issuerUrl !== undefined ? { issuerUrl: body.issuerUrl } : {}),
        ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
        ...(body.clientSecret !== undefined
          ? {
              clientSecretCiphertext: body.clientSecret ? encryptSecret(body.clientSecret) : null
            }
          : {}),
        ...(body.authorizationEndpoint !== undefined ? { authorizationEndpoint: body.authorizationEndpoint } : {}),
        ...(body.tokenEndpoint !== undefined ? { tokenEndpoint: body.tokenEndpoint } : {}),
        ...(body.jwksUri !== undefined ? { jwksUri: body.jwksUri } : {}),
        ...(body.samlMetadataXml !== undefined ? { samlMetadataXml: body.samlMetadataXml } : {}),
        ...(body.samlEntityId !== undefined ? { samlEntityId: body.samlEntityId } : {}),
        ...(body.samlSsoUrl !== undefined ? { samlSsoUrl: body.samlSsoUrl } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {})
      }
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "workspace_sso_provider_update",
      targetType: "IdentityProviderConfig",
      targetId: provider.id,
      details: {
        providerType: provider.type,
        providerName: provider.name,
        enabled: provider.enabled
      }
    });

    return jsonOk({
      workspaceId: workspace.id,
      provider: serializeIdentityProvider(provider)
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
