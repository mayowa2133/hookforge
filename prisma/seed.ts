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
