import { createHash, randomUUID } from "crypto";
import { prisma } from "./prisma";
import { env } from "./env";

function salt() {
  return env.PUBLIC_API_KEY_SALT || env.SESSION_SECRET;
}

export function hashApiKey(rawKey: string) {
  return createHash("sha256").update(`${salt()}:${rawKey}`).digest("hex");
}

export function makeApiKeyPrefix(rawKey: string) {
  return rawKey.slice(0, 12);
}

export function generateApiKey() {
  return `hfpk_${randomUUID().replace(/-/g, "")}`;
}

function readApiKeyFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization && authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  const xApiKey = request.headers.get("x-api-key");
  return xApiKey?.trim() || null;
}

export async function authenticatePublicApiKey(request: Request) {
  const raw = readApiKeyFromRequest(request);
  if (!raw) {
    throw new Error("Unauthorized");
  }

  const keyHash = hashApiKey(raw);

  const apiKey = await prisma.publicApiKey.findUnique({
    where: { keyHash },
    include: {
      workspace: true
    }
  });

  if (!apiKey) {
    throw new Error("Unauthorized");
  }

  if (apiKey.status !== "ACTIVE") {
    throw new Error("API key is disabled");
  }

  await prisma.publicApiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() }
  });

  return apiKey;
}
