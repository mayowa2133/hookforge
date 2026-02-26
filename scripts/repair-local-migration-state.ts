import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import "dotenv/config";

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

function parseNamesFromSchema(schema: string, kind: "model" | "enum") {
  const pattern = new RegExp(`^${kind}\\s+([A-Za-z0-9_]+)\\s+\\{`, "gm");
  const names: string[] = [];
  for (const match of schema.matchAll(pattern)) {
    names.push(match[1]);
  }
  return names;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const root = process.cwd();
    const migrationsDir = path.join(root, "prisma", "migrations");
    const schemaPath = path.join(root, "prisma", "schema.prisma");

    const schemaSource = await readFile(schemaPath, "utf8");
    const modelNames = parseNamesFromSchema(schemaSource, "model");
    const enumNames = parseNamesFromSchema(schemaSource, "enum");

    const existingTables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public'`
    );
    const existingTableSet = new Set(existingTables.map((entry) => entry.tablename));
    const missingTables = modelNames.filter((name) => !existingTableSet.has(name));
    if (missingTables.length > 0) {
      throw new Error(
        `Cannot repair migration state: schema objects are missing. Missing tables: ${missingTables.join(", ")}`
      );
    }

    const existingTypes = await prisma.$queryRawUnsafe<Array<{ typname: string }>>(
      `SELECT typname FROM pg_type WHERE typname = ANY($1::text[])`,
      enumNames
    );
    const existingTypeSet = new Set(existingTypes.map((entry) => entry.typname));
    const missingEnums = enumNames.filter((name) => !existingTypeSet.has(name));
    if (missingEnums.length > 0) {
      throw new Error(
        `Cannot repair migration state: enum types are missing. Missing enums: ${missingEnums.join(", ")}`
      );
    }

    const dirEntries = await readdir(migrationsDir, { withFileTypes: true });
    const migrations = dirEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const rows = await prisma.$queryRawUnsafe<MigrationRow[]>(
      `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`
    );

    const byName = new Map<string, MigrationRow[]>();
    for (const row of rows) {
      const bucket = byName.get(row.migration_name) ?? [];
      bucket.push(row);
      byName.set(row.migration_name, bucket);
    }

    let rolledBackCount = 0;
    for (const migration of migrations) {
      const bucket = byName.get(migration) ?? [];
      const hasFinished = bucket.some((row) => row.finished_at !== null);
      if (hasFinished) {
        continue;
      }
      const hasPending = bucket.some((row) => row.finished_at === null && row.rolled_back_at === null);
      if (!hasPending) {
        continue;
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "_prisma_migrations"
         SET rolled_back_at = NOW(),
             logs = COALESCE(logs, '') || E'\\n[repair-local-migration-state] marked rolled back after schema reconciliation'
         WHERE migration_name = $1
           AND finished_at IS NULL
           AND rolled_back_at IS NULL`,
        migration
      );
      rolledBackCount += 1;
    }

    let appliedCount = 0;
    for (const migration of migrations) {
      const sqlPath = path.join(migrationsDir, migration, "migration.sql");
      const sql = await readFile(sqlPath);
      const checksum = createHash("sha256").update(sql).digest("hex");

      const bucket = await prisma.$queryRawUnsafe<MigrationRow[]>(
        `SELECT migration_name, finished_at, rolled_back_at
         FROM "_prisma_migrations"
         WHERE migration_name = $1`,
        migration
      );
      const hasFinished = bucket.some((row) => row.finished_at !== null);
      if (hasFinished) {
        continue;
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES
          ($1, $2, NOW(), $3, $4, NULL, NOW(), 1)`,
        randomUUID(),
        checksum,
        migration,
        "[repair-local-migration-state] marked applied after schema and enum reconciliation"
      );
      appliedCount += 1;
    }

    // eslint-disable-next-line no-console
    console.log(
      `Migration state repaired. rolledBackPending=${rolledBackCount} markedApplied=${appliedCount} verifiedTables=${modelNames.length} verifiedEnums=${enumNames.length}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
