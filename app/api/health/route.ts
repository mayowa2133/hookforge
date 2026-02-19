import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { queueConnection } from "@/lib/queue";
import Redis from "ioredis";

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "ok";
  } catch {
    return "error";
  }
}

async function checkRedis() {
  const client = new Redis({
    ...queueConnection,
    lazyConnect: true,
    connectTimeout: 1000,
    maxRetriesPerRequest: 1
  });

  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "unknown";
  } finally {
    client.disconnect(false);
  }
}

export async function GET() {
  const db = await checkDatabase();
  const redis = await checkRedis();
  const healthy = db === "ok" && (redis === "ok" || redis === "unknown");

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      services: {
        database: db,
        redis
      },
      timestamp: new Date().toISOString()
    },
    { status: healthy ? 200 : 503 }
  );
}
