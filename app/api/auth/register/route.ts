import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { attachSessionCookie, createSessionToken, hashPassword } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
import { ensurePersonalWorkspace } from "@/lib/workspaces";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = RegisterSchema.parse(await request.json());
    const email = body.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash
      },
      select: {
        id: true,
        email: true,
        createdAt: true
      }
    });

    // Best-effort workspace bootstrap for phase-0 parity scaffolding.
    await ensurePersonalWorkspace(user.id, user.email).catch((workspaceError) => {
      console.warn("Could not bootstrap personal workspace", workspaceError);
    });

    const token = await createSessionToken({ sub: user.id, email: user.email });
    const response = NextResponse.json({ user }, { status: 201 });
    attachSessionCookie(response, token);

    return response;
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
