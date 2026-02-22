import "dotenv/config";
import { ProjectStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { ensureProjectV2FromLegacy } from "../lib/project-v2";
import { ensurePersonalWorkspace } from "../lib/workspaces";

function parseStatusesArg() {
  const index = process.argv.findIndex((arg) => arg === "--statuses");
  if (index === -1) {
    return [ProjectStatus.DRAFT, ProjectStatus.READY, ProjectStatus.RENDERING];
  }
  const raw = process.argv[index + 1];
  if (!raw) {
    return [ProjectStatus.DRAFT, ProjectStatus.READY, ProjectStatus.RENDERING];
  }

  const statuses = raw
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean)
    .filter((value): value is ProjectStatus => value in ProjectStatus);

  return statuses.length > 0 ? statuses : [ProjectStatus.DRAFT, ProjectStatus.READY, ProjectStatus.RENDERING];
}

async function main() {
  const statuses = parseStatusesArg();

  const legacyProjects = await prisma.project.findMany({
    where: {
      status: {
        in: statuses
      }
    },
    include: {
      user: {
        select: {
          id: true,
          email: true
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  let migratedCount = 0;
  let linkedWorkspaceCount = 0;
  let alreadyPresentCount = 0;

  for (const legacyProject of legacyProjects) {
    if (!legacyProject.user) {
      continue;
    }

    const existing = await prisma.projectV2.findUnique({
      where: {
        legacyProjectId: legacyProject.id
      },
      select: {
        id: true
      }
    });

    if (existing) {
      alreadyPresentCount += 1;
      continue;
    }

    const workspace = await ensurePersonalWorkspace(legacyProject.user.id, legacyProject.user.email);

    if (!legacyProject.workspaceId) {
      await prisma.project.update({
        where: { id: legacyProject.id },
        data: {
          workspaceId: workspace.id
        }
      });
      linkedWorkspaceCount += 1;
    }

    await ensureProjectV2FromLegacy({
      legacyProjectId: legacyProject.id,
      workspaceId: legacyProject.workspaceId ?? workspace.id,
      createdByUserId: legacyProject.user.id,
      title: legacyProject.title,
      status: legacyProject.status
    });

    migratedCount += 1;
  }

  console.log(
    JSON.stringify(
      {
        statuses,
        scanned: legacyProjects.length,
        migratedCount,
        alreadyPresentCount,
        linkedWorkspaceCount
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
