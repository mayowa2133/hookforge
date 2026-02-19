import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ensurePersonalWorkspace } from "../lib/workspaces";
import { generateApiKey, hashApiKey, makeApiKeyPrefix } from "../lib/public-api";

function parseArg(name: string) {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const emailInput = parseArg("email");
  const keyName = parseArg("name") ?? "Default API key";

  if (!emailInput) {
    throw new Error("Usage: tsx scripts/create-api-key.ts --email user@example.com [--name \"My Key\"]");
  }

  const email = emailInput.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`User not found: ${email}`);
  }

  const workspace = await ensurePersonalWorkspace(user.id, user.email);
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);

  const apiKey = await prisma.publicApiKey.create({
    data: {
      workspaceId: workspace.id,
      createdByUserId: user.id,
      name: keyName,
      keyPrefix: makeApiKeyPrefix(rawKey),
      keyHash,
      status: "ACTIVE"
    }
  });

  console.log(JSON.stringify({
    workspaceId: workspace.id,
    apiKeyId: apiKey.id,
    keyPrefix: apiKey.keyPrefix,
    apiKey: rawKey
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
