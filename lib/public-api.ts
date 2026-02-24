import { createHash, randomUUID } from "crypto";
import { hasApiScope, type PublicApiScope } from "./enterprise-security";
import { prisma } from "./prisma";
import { withRedis } from "./redis";
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
  return authenticatePublicApiKeyWithScope(request);
}

async function enforceApiKeyRateLimit(params: {
  keyId: string;
  limitPerMinute: number;
}) {
  const windowStart = Math.floor(Date.now() / 60_000);
  const redisKey = `rate:public-api:${params.keyId}:${windowStart}`;
  const count = await withRedis(async (client) => {
    const next = await client.incr(redisKey);
    if (next === 1) {
      await client.expire(redisKey, 120);
    }
    return next;
  });

  if (count > params.limitPerMinute) {
    throw new Error("Rate limit exceeded for API key");
  }
}

export async function authenticatePublicApiKeyWithScope(request: Request, requiredScope?: PublicApiScope) {
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

  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
    throw new Error("API key is disabled");
  }

  if (env.ENABLE_API_KEY_SCOPES && requiredScope && !hasApiScope(apiKey.scopes, requiredScope)) {
    throw new Error("API key scope denied");
  }

  if (env.ENABLE_API_KEY_SCOPES) {
    await enforceApiKeyRateLimit({
      keyId: apiKey.id,
      limitPerMinute: Math.max(10, apiKey.rateLimitPerMinute || 120)
    });
  }

  await prisma.publicApiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() }
  });

  return apiKey;
}
