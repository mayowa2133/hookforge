import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { attachSessionCookie, createSessionToken, verifyPassword } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
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

    const token = await createSessionToken({ sub: user.id, email: user.email });
    const response = NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt
        }
      },
      { status: 200 }
    );
    attachSessionCookie(response, token);

    return response;
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
