import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { templateCatalog } from "../lib/template-catalog";

const prisma = new PrismaClient();

async function main() {
  for (const template of templateCatalog) {
    await prisma.template.upsert({
      where: { slug: template.slug },
      update: {
        name: template.name,
        description: template.description,
        tags: template.tags,
        slotSchema: template.slotSchema
      },
      create: {
        slug: template.slug,
        name: template.name,
        description: template.description,
        tags: template.tags,
        slotSchema: template.slotSchema
      }
    });
  }

  const qualityModelSeeds = [
    { capability: "asr", provider: "deepgram", model: "nova", version: "v1", status: "ACTIVE" as const },
    { capability: "translation", provider: "llm-translation", model: "mt", version: "v1", status: "ACTIVE" as const },
    { capability: "dubbing", provider: "elevenlabs", model: "tts", version: "v1", status: "ACTIVE" as const },
    { capability: "lipsync", provider: "sync-api", model: "sync", version: "v1", status: "ACTIVE" as const },
    { capability: "chat_edit", provider: "gen-media-fallback", model: "planner", version: "v1", status: "ACTIVE" as const }
  ];

  for (const seed of qualityModelSeeds) {
    await prisma.modelVersion.upsert({
      where: {
        capability_provider_model_version: {
          capability: seed.capability,
          provider: seed.provider,
          model: seed.model,
          version: seed.version
        }
      },
      update: {
        status: seed.status
      },
      create: {
        capability: seed.capability,
        provider: seed.provider,
        model: seed.model,
        version: seed.version,
        status: seed.status
      }
    });
  }

  console.log(`Seeded ${templateCatalog.length} templates.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
