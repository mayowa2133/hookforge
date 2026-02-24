import { withRedis } from "./redis";

export async function enforceIdempotencyKey(params: {
  request: Request;
  scope: string;
  ttlSeconds?: number;
  required?: boolean;
}) {
  const key = params.request.headers.get("idempotency-key")?.trim();
  const required = params.required ?? true;

  if (!key) {
    if (required) {
      throw new Error("Missing idempotency key");
    }
    return null;
  }

  if (key.length < 8 || key.length > 200) {
    throw new Error("Invalid idempotency key");
  }

  const redisKey = `idempotency:${params.scope}:${key}`;
  const acquired = await withRedis(async (client) => {
    const result = await client.set(redisKey, "1", "EX", params.ttlSeconds ?? 15 * 60, "NX");
    return result === "OK";
  });

  if (!acquired) {
    throw new Error("Duplicate idempotent request");
  }

  return redisKey;
}
