import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { ensureWorkspaceSecurityPolicy, serializeIdentityProvider } from "@/lib/enterprise-security";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { enforceIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secret-box";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const ProviderSchema = z
  .object({
    type: z.enum(["OIDC", "SAML"]),
    name: z.string().min(2).max(80),
    issuerUrl: z.string().url().optional(),
    clientId: z.string().min(2).max(240).optional(),
    clientSecret: z.string().min(2).max(2000).optional(),
    authorizationEndpoint: z.string().url().optional(),
    tokenEndpoint: z.string().url().optional(),
    jwksUri: z.string().url().optional(),
    samlMetadataXml: z.string().min(10).max(200000).optional(),
    samlEntityId: z.string().min(2).max(400).optional(),
    samlSsoUrl: z.string().url().optional(),
    enabled: z.boolean().default(true)
  })
  .superRefine((value, ctx) => {
    if (value.type === "OIDC") {
      if (!value.issuerUrl && (!value.authorizationEndpoint || !value.tokenEndpoint)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "OIDC requires issuerUrl or both authorizationEndpoint + tokenEndpoint"
        });
      }
      if (!value.clientId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "OIDC requires clientId"
        });
      }
    }
    if (value.type === "SAML") {
      if (!value.samlMetadataXml && (!value.samlEntityId || !value.samlSsoUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SAML requires metadata XML or both entity ID + SSO URL"
        });
      }
    }
  });

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "workspace.security.read",
      request
    });
    await ensureWorkspaceSecurityPolicy(workspace.id);

    const providers = await prisma.identityProviderConfig.findMany({
      where: {
        workspaceId: workspace.id
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    return jsonOk({
      workspaceId: workspace.id,
      providers: providers.map(serializeIdentityProvider)
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
      scope: `workspace-sso-provider-create:${workspace.id}`
    });
    const body = ProviderSchema.parse(await request.json());

    const provider = await prisma.identityProviderConfig.create({
      data: {
        workspaceId: workspace.id,
        createdByUserId: user.id,
        type: body.type,
        name: body.name.trim(),
        issuerUrl: body.issuerUrl,
        clientId: body.clientId,
        clientSecretCiphertext: body.clientSecret ? encryptSecret(body.clientSecret) : null,
        authorizationEndpoint: body.authorizationEndpoint,
        tokenEndpoint: body.tokenEndpoint,
        jwksUri: body.jwksUri,
        samlMetadataXml: body.samlMetadataXml,
        samlEntityId: body.samlEntityId,
        samlSsoUrl: body.samlSsoUrl,
        enabled: body.enabled
      }
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "workspace_sso_provider_create",
      targetType: "IdentityProviderConfig",
      targetId: provider.id,
      details: {
        providerType: provider.type,
        providerName: provider.name,
        enabled: provider.enabled
      }
    });

    return jsonOk(
      {
        workspaceId: workspace.id,
        provider: serializeIdentityProvider(provider)
      },
      201
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
