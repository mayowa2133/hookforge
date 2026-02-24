import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { attachSessionCookie, createSessionToken, hashPassword } from "@/lib/auth";
import { jsonError, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { parseSamlAcsPayload } from "@/lib/sso";

export const runtime = "nodejs";

const AcsSchema = z.object({
  providerId: z.string().min(1),
  workspaceSlug: z.string().min(2).max(120).optional(),
  samlResponse: z.string().optional(),
  nameId: z.string().optional(),
  email: z.string().email().optional(),
  relayState: z.string().optional()
});

async function parseAcsInput(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return {
      providerId: String(form.get("providerId") || ""),
      workspaceSlug: form.get("workspaceSlug") ? String(form.get("workspaceSlug")) : undefined,
      samlResponse: form.get("SAMLResponse") ? String(form.get("SAMLResponse")) : undefined,
      nameId: form.get("NameID") ? String(form.get("NameID")) : undefined,
      email: form.get("email") ? String(form.get("email")) : undefined,
      relayState: form.get("RelayState") ? String(form.get("RelayState")) : undefined
    };
  }
  return request.json();
}

export async function POST(request: Request) {
  try {
    const raw = await parseAcsInput(request);
    const relayStateJson =
      typeof raw.relayState === "string" && raw.relayState.startsWith("{") ? JSON.parse(raw.relayState) : null;
    const body = AcsSchema.parse({
      ...raw,
      providerId: raw.providerId || relayStateJson?.providerId,
      workspaceSlug: raw.workspaceSlug || relayStateJson?.workspaceSlug,
      relayState:
        typeof raw.relayState === "string" && raw.relayState.startsWith("{")
          ? relayStateJson?.returnTo
          : raw.relayState
    });

    const provider = await prisma.identityProviderConfig.findFirst({
      where: {
        id: body.providerId,
        type: "SAML",
        enabled: true,
        ...(body.workspaceSlug
          ? {
              workspace: {
                slug: body.workspaceSlug
              }
            }
          : {})
      },
      include: {
        workspace: {
          include: {
            securityPolicy: true
          }
        }
      }
    });

    if (!provider) {
      return jsonError("SAML provider not found", 404);
    }

    const parsed = parseSamlAcsPayload({
      samlResponse: body.samlResponse,
      nameId: body.nameId,
      email: body.email
    });

    const user = await prisma.user.upsert({
      where: {
        email: parsed.email
      },
      update: {},
      create: {
        email: parsed.email,
        passwordHash: await hashPassword(randomUUID())
      }
    });

    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: provider.workspaceId,
          userId: user.id
        }
      },
      update: {},
      create: {
        workspaceId: provider.workspaceId,
        userId: user.id,
        role: "VIEWER"
      }
    });

    await prisma.userIdentity.upsert({
      where: {
        providerId_providerSubject: {
          providerId: provider.id,
          providerSubject: parsed.providerSubject
        }
      },
      update: {
        userId: user.id,
        workspaceId: provider.workspaceId,
        email: parsed.email,
        providerType: "SAML"
      },
      create: {
        workspaceId: provider.workspaceId,
        userId: user.id,
        providerId: provider.id,
        providerType: "SAML",
        providerSubject: parsed.providerSubject,
        email: parsed.email,
        metadata: {
          hasRawResponse: Boolean(body.samlResponse)
        }
      }
    });

    const session = await prisma.ssoSession.create({
      data: {
        workspaceId: provider.workspaceId,
        providerId: provider.id,
        userId: user.id,
        state: randomUUID().replace(/-/g, ""),
        status: "COMPLETED",
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        userAgent: request.headers.get("user-agent") ?? undefined,
        ipAddress: request.headers.get("x-forwarded-for") ?? undefined
      }
    });

    await prisma.auditEvent.create({
      data: {
        workspaceId: provider.workspaceId,
        actorUserId: user.id,
        action: "sso_saml_acs",
        targetType: "SsoSession",
        targetId: session.id,
        metadata: {
          providerId: provider.id
        }
      }
    });

    const ttlHours = provider.workspace.securityPolicy?.sessionTtlHours ?? 168;
    const token = await createSessionToken(
      {
        sub: user.id,
        email: user.email
      },
      ttlHours
    );
    const response = NextResponse.json(
      {
        status: "SIGNED_IN",
        redirectTo: body.relayState || "/dashboard"
      },
      { status: 200 }
    );
    attachSessionCookie(response, token, ttlHours);
    return response;
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
