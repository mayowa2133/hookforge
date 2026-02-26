import { getLatestDescriptDiffStatus } from "@/lib/parity/certification";
import { prisma } from "@/lib/prisma";

async function resolveWorkspaceId() {
  const explicit = process.env.PARITY_WORKSPACE_ID?.trim();
  if (explicit) {
    return explicit;
  }
  const targetEnv = (process.env.PARITY_GATE_TARGET_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
  if (targetEnv === "production" || targetEnv === "staging" || process.env.PARITY_REQUIRE_WORKSPACE_ID === "true") {
    throw new Error("PARITY_WORKSPACE_ID is required for production/staging descript diff checks.");
  }
  const workspace = await prisma.workspace.findFirst({
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true
    }
  });
  if (!workspace) {
    throw new Error("No workspace found for descript diff check");
  }
  return workspace.id;
}

async function main() {
  const workspaceId = await resolveWorkspaceId();
  const status = await getLatestDescriptDiffStatus(workspaceId);

  console.log(JSON.stringify(status, null, 2));

  if (!status.passed) {
    process.exit(2);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
