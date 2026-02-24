import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { attachSessionCookie, createSessionToken, verifyPassword } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
import { ensurePersonalWorkspace } from "@/lib/workspaces";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  workspaceSlug: z.string().min(2).max(120).optional()
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = LoginSchema.parse(await request.json());
    const email = body.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const workspace = body.workspaceSlug
      ? await prisma.workspace.findFirst({
          where: {
            slug: body.workspaceSlug,
            members: {
              some: {
                userId: user.id
              }
            }
          }
        })
      : await ensurePersonalWorkspace(user.id, user.email);

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found or inaccessible" }, { status: 404 });
    }

    const policy = await prisma.workspaceSecurityPolicy.findUnique({
      where: {
        workspaceId: workspace.id
      }
    });

    if (policy?.enforceSso && !policy.allowPasswordAuth) {
      await prisma.auditEvent.create({
        data: {
          workspaceId: workspace.id,
          actorUserId: user.id,
          action: "credentials_login_blocked_sso_policy",
          targetType: "WorkspaceSecurityPolicy",
          targetId: policy.id,
          severity: "WARN",
          metadata: {
            workspaceSlug: workspace.slug
          }
        }
      });
      const providers = await prisma.identityProviderConfig.findMany({
        where: {
          workspaceId: workspace.id,
          enabled: true
        },
        select: {
          id: true,
          type: true,
          name: true
        }
      });
      return NextResponse.json(
        {
          error: "Password login disabled. Use SSO for this workspace.",
          code: "SSO_REQUIRED",
          workspace: {
            slug: workspace.slug
          },
          providers
        },
        { status: 403 }
      );
    }

    const sessionTtlHours = policy?.sessionTtlHours ?? 24 * 7;
    const token = await createSessionToken({ sub: user.id, email: user.email }, sessionTtlHours);
    const response = NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug
        },
        session: {
          ttlHours: sessionTtlHours
        }
      },
      { status: 200 }
    );
    attachSessionCookie(response, token, sessionTtlHours);

    await prisma.auditEvent.create({
      data: {
        workspaceId: workspace.id,
        actorUserId: user.id,
        action: "credentials_login_success",
        targetType: "Workspace",
        targetId: workspace.id,
        metadata: {
          workspaceSlug: workspace.slug,
          sessionTtlHours
        }
      }
    });

    return response;
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
