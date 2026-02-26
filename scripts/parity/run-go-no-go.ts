import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { resolveReleaseWorkspace } from "@/scripts/parity/release-remediation-helpers";

type CommandResult = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ok: boolean;
};

function runCommand(command: string, env: NodeJS.ProcessEnv): CommandResult {
  const result = spawnSync(command, {
    cwd: process.cwd(),
    env,
    shell: true,
    encoding: "utf8"
  });

  return {
    command,
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ok: result.status === 0
  };
}

function parseLastJsonObject(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  for (let index = trimmed.lastIndexOf("{"); index >= 0; index = trimmed.lastIndexOf("{", index - 1)) {
    try {
      return JSON.parse(trimmed.slice(index)) as Record<string, unknown>;
    } catch {
      // keep scanning earlier "{" positions
    }
  }
  return null;
}

async function main() {
  const workspace = await resolveReleaseWorkspace();
  const workspaceId = workspace.workspaceId;
  const pnpmCommand =
    process.env.PARITY_PNPM_BIN?.trim() ||
    (existsSync(".corepack/v1/pnpm/9.12.3/bin/pnpm.cjs")
      ? "node .corepack/v1/pnpm/9.12.3/bin/pnpm.cjs"
      : "pnpm");
  const sharedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PARITY_WORKSPACE_ID: workspaceId,
    PARITY_GATE_TARGET_ENV: "production",
    NODE_ENV: "production"
  };

  const commands = [
    `${pnpmCommand} desktop:release:validate`,
    `${pnpmCommand} quality:descript-diff`,
    `${pnpmCommand} quality:phase6-certification`,
    `${pnpmCommand} quality:parity-gate`
  ];

  const results = commands.map((command) => runCommand(command, sharedEnv));
  const failedCommands = results.filter((result) => !result.ok).map((result) => result.command);
  const gateResult = parseLastJsonObject(
    results.find((result) => result.command.endsWith("quality:parity-gate"))?.stdout ?? ""
  );
  const certificationResult = parseLastJsonObject(
    results.find((result) => result.command.endsWith("quality:phase6-certification"))?.stdout ?? ""
  );

  const providerGatePassed = gateResult?.checks && typeof gateResult.checks === "object"
    ? (gateResult.checks as Record<string, unknown>).providerGatePassed === true
    : false;
  const gatePassed = typeof gateResult?.gatePassed === "boolean" ? gateResult.gatePassed : false;
  const certificationPassed =
    typeof certificationResult?.certificationPassed === "boolean"
      ? certificationResult.certificationPassed
      : false;
  const go = failedCommands.length === 0 && gatePassed && certificationPassed && providerGatePassed;

  console.log(
    JSON.stringify(
      {
        workspaceId,
        decision: go ? "GO" : "NO_GO",
        commandResults: results.map((result) => ({
          command: result.command,
          exitCode: result.exitCode,
          ok: result.ok
        })),
        gatePassed,
        certificationPassed,
        providerGatePassed,
        failedCommands
      },
      null,
      2
    )
  );

  if (!go) {
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
