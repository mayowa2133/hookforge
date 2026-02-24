import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { env } from "./env";

const SESSION_COOKIE = "hookforge_session";
const encoder = new TextEncoder();

type SessionPayload = {
  sub: string;
  email: string;
};

const DEFAULT_SESSION_TTL_HOURS = 24 * 7;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(payload: SessionPayload, ttlHours = DEFAULT_SESSION_TTL_HOURS) {
  const safeHours = Number.isFinite(ttlHours) ? Math.max(1, Math.min(24 * 30, Math.floor(ttlHours))) : DEFAULT_SESSION_TTL_HOURS;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${safeHours}h`)
    .sign(encoder.encode(env.SESSION_SECRET));
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const result = await jwtVerify(token, encoder.encode(env.SESSION_SECRET));
    return {
      sub: result.payload.sub ?? "",
      email: typeof result.payload.email === "string" ? result.payload.email : ""
    };
  } catch {
    return null;
  }
}

export function attachSessionCookie(response: NextResponse, token: string, ttlHours = DEFAULT_SESSION_TTL_HOURS) {
  const safeHours = Number.isFinite(ttlHours) ? Math.max(1, Math.min(24 * 30, Math.floor(ttlHours))) : DEFAULT_SESSION_TTL_HOURS;
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * safeHours
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

export async function getCurrentUser() {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  const session = await verifySessionToken(token);
  if (!session?.sub) {
    return null;
  }
  return prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, email: true, createdAt: true }
  });
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}
