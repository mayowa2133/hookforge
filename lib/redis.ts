import Redis from "ioredis";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __hookforgeRedis: Redis | undefined;
}

function createRedisClient() {
  const redisUrl = new URL(env.REDIS_URL);
  return new Redis({
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username || undefined,
    password: redisUrl.password || undefined,
    tls: redisUrl.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
    lazyConnect: true
  });
}

export function getRedisClient() {
  if (!global.__hookforgeRedis) {
    global.__hookforgeRedis = createRedisClient();
  }
  return global.__hookforgeRedis;
}

export async function withRedis<T>(fn: (client: Redis) => Promise<T>) {
  const client = getRedisClient();
  if (client.status === "wait") {
    await client.connect();
  }
  return fn(client);
}
