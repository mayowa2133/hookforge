import { prisma } from "@/lib/prisma";
import { qualityCapabilities } from "@/lib/quality/types";

const defaultCapabilities = [
  "asr",
  "translation",
  "dubbing",
  "lipsync",
  "ai_edit",
  "chat_edit",
  "creator",
  "ads",
  "shorts",
  "public_translate"
] as const;

export function normalizeRoutingCapability(input: string) {
  const normalized = input.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (qualityCapabilities as readonly string[]).includes(normalized) ? normalized : "general";
}

export async function ensureDefaultRoutingPolicies() {
  for (const capability of defaultCapabilities) {
    await prisma.routingPolicy.upsert({
      where: { capability },
      update: {},
      create: {
        capability,
        rolloutPercent: 100,
        enforceQualityGate: true
      }
    });
  }
}

export async function listRoutingPolicies() {
  await ensureDefaultRoutingPolicies();
  return prisma.routingPolicy.findMany({
    include: {
      activeModelVersion: true,
      fallbackModelVersion: true,
      updatedBy: {
        select: {
          id: true,
          email: true
        }
      }
    },
    orderBy: { capability: "asc" }
  });
}
