import { randomUUID } from "crypto";
import { z } from "zod";
import { buildOidcAuthorizationUrl } from "@/lib/sso";
import { jsonError, jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { defaultSsoSessionExpiry, generateSsoState } from "@/lib/enterprise-security";

export const runtime = "nodejs";

const StartSchema = z.object({
  workspaceSlug: z.string().min(2).max(120),
  providerId: z.string().min(1).optional(),
  returnTo: z.string().min(1).max(1000).optional()
});

export async function POST(request: Request) {
  try {
    const body = StartSchema.parse(await request.json());
    const workspace = await prisma.workspace.findUnique({
      where: {
        slug: body.workspaceSlug
      },
      select: {
        id: true,
        slug: true,
        securityPolicy: true
      }
    });

    if (!workspace) {
      return jsonError("Workspace not found", 404);
    }

    if (!workspace.securityPolicy?.enforceSso) {
      return jsonError("SSO is not enforced for this workspace", 400);
    }

    const provider = await prisma.identityProviderConfig.findFirst({
      where: {
        workspaceId: workspace.id,
        id: body.providerId,
        type: "OIDC",
        enabled: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    if (!provider) {
      return jsonError("OIDC provider not found", 404);
    }

    const state = generateSsoState();
    const nonce = randomUUID().replace(/-/g, "");
    const codeVerifier = randomUUID().replace(/-/g, "");
    const redirectUrl = buildOidcAuthorizationUrl({
      provider,
      state,
      nonce,
      codeChallenge: codeVerifier
    });

    const session = await prisma.ssoSession.create({
      data: {
        workspaceId: workspace.id,
        providerId: provider.id,
        state,
        nonce,
        codeVerifier,
        returnTo: body.returnTo,
        status: "INITIATED",
        expiresAt: defaultSsoSessionExpiry(),
        userAgent: request.headers.get("user-agent") ?? undefined,
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined
      }
    });

    await prisma.auditEvent.create({
      data: {
        workspaceId: workspace.id,
        action: "sso_oidc_start",
        targetType: "SsoSession",
        targetId: session.id,
        metadata: {
          providerId: provider.id,
          workspaceSlug: workspace.slug
        }
      }
    });

    return jsonOk({
      workspaceSlug: workspace.slug,
      providerId: provider.id,
      sessionId: session.id,
      state,
      redirectUrl
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
