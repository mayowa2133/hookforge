import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { resolveReleaseWorkspace, shouldWriteParityEnvFile } from "@/scripts/parity/release-remediation-helpers";

async function main() {
  const workspace = await resolveReleaseWorkspace();
  const envFilePath = resolve(process.cwd(), process.env.PARITY_RELEASE_ENV_FILE?.trim() || ".parity-release.env");
  const writeEnvFile = shouldWriteParityEnvFile();
  const envFileBody = [
    `PARITY_WORKSPACE_ID=${workspace.workspaceId}`,
    "PARITY_GATE_TARGET_ENV=production",
    "NODE_ENV=production",
    "ALLOW_MOCK_PROVIDERS=false"
  ].join("\n");

  if (writeEnvFile) {
    await mkdir(dirname(envFilePath), { recursive: true });
    await writeFile(envFilePath, `${envFileBody}\n`, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        workspaceId: workspace.workspaceId,
        workspaceSlug: workspace.workspaceSlug,
        workspaceName: workspace.workspaceName,
        ownerId: workspace.ownerId,
        source: workspace.source,
        envFilePath: writeEnvFile ? envFilePath : null,
        exports: {
          PARITY_WORKSPACE_ID: workspace.workspaceId,
          PARITY_GATE_TARGET_ENV: "production",
          NODE_ENV: "production",
          ALLOW_MOCK_PROVIDERS: "false"
        }
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
