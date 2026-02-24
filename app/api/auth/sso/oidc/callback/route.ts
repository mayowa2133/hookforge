import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { attachSessionCookie, createSessionToken, hashPassword } from "@/lib/auth";
import { jsonError, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const queryEmail = url.searchParams.get("email");
    const querySubject = url.searchParams.get("sub");

    if (!state || !code) {
      return jsonError("Missing state or code", 400);
    }

    const session = await prisma.ssoSession.findUnique({
      where: {
        state
      },
      include: {
        workspace: {
          include: {
            securityPolicy: true
          }
        },
        provider: true
      }
    });

    if (!session || session.status !== "INITIATED") {
      return jsonError("Invalid SSO session", 400);
    }

    if (session.expiresAt.getTime() < Date.now()) {
      await prisma.ssoSession.update({
        where: {
          id: session.id
        },
        data: {
          status: "EXPIRED",
          errorMessage: "Session expired"
        }
      });
      return jsonError("SSO session expired", 400);
    }

    const providerSubject = querySubject?.trim() || `oidc:${code}`;
    const email = queryEmail?.trim().toLowerCase() || `${providerSubject.replace(/[^a-zA-Z0-9._-]/g, "")}@sso.local`;

    const user = await prisma.user.upsert({
      where: {
        email
      },
      update: {},
      create: {
        email,
        passwordHash: await hashPassword(randomUUID())
      }
    });

    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: session.workspaceId,
          userId: user.id
        }
      },
      update: {},
      create: {
        workspaceId: session.workspaceId,
        userId: user.id,
        role: "VIEWER"
      }
    });

    await prisma.userIdentity.upsert({
      where: {
        providerId_providerSubject: {
          providerId: session.providerId,
          providerSubject
        }
      },
      update: {
        userId: user.id,
        workspaceId: session.workspaceId,
        email,
        providerType: "OIDC"
      },
      create: {
        workspaceId: session.workspaceId,
        userId: user.id,
        providerId: session.providerId,
        providerType: "OIDC",
        providerSubject,
        email
      }
    });

    await prisma.ssoSession.update({
      where: {
        id: session.id
      },
      data: {
        userId: user.id,
        status: "COMPLETED",
        completedAt: new Date()
      }
    });

    await prisma.auditEvent.create({
      data: {
        workspaceId: session.workspaceId,
        actorUserId: user.id,
        action: "sso_oidc_callback",
        targetType: "SsoSession",
        targetId: session.id,
        metadata: {
          providerId: session.providerId
        }
      }
    });

    const ttlHours = session.workspace.securityPolicy?.sessionTtlHours ?? 168;
    const token = await createSessionToken(
      {
        sub: user.id,
        email: user.email
      },
      ttlHours
    );
    const response = NextResponse.redirect(new URL(session.returnTo || "/dashboard", request.url));
    attachSessionCookie(response, token, ttlHours);
    return response;
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
