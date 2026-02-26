import { buildPhase6CertificationReadout } from "@/lib/parity/certification";
import { prisma } from "@/lib/prisma";

async function resolveWorkspaceId() {
  const explicit = process.env.PARITY_WORKSPACE_ID?.trim();
  if (explicit) {
    return explicit;
  }
  const targetEnv = (process.env.PARITY_GATE_TARGET_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
  if (targetEnv === "production" || targetEnv === "staging" || process.env.PARITY_REQUIRE_WORKSPACE_ID === "true") {
    throw new Error("PARITY_WORKSPACE_ID is required for production/staging certification runs.");
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
    throw new Error("No workspace found for certification run");
  }
  return workspace.id;
}

async function main() {
  const workspaceId = await resolveWorkspaceId();
  const persistRun = process.env.PARITY_CERTIFICATION_PERSIST !== "false";
  const readout = await buildPhase6CertificationReadout({
    workspaceId,
    persistRun
  });

  console.log(
    JSON.stringify(
      {
        ...readout,
        persistence: {
          persistRun
        }
      },
      null,
      2
    )
  );

  if (!readout.certificationPassed) {
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
