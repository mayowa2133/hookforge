import { prisma } from "./prisma";

type ResolveLegacyProjectIdParams = {
  projectIdOrV2Id: string;
  userId: string;
};

export async function resolveLegacyProjectIdForUser(params: ResolveLegacyProjectIdParams) {
  const directLegacy = await prisma.project.findFirst({
    where: {
      id: params.projectIdOrV2Id,
      userId: params.userId
    },
    select: { id: true }
  });

  if (directLegacy) {
    return directLegacy.id;
  }

  const projectV2 = await prisma.projectV2.findFirst({
    where: {
      id: params.projectIdOrV2Id,
      workspace: {
        members: {
          some: {
            userId: params.userId
          }
        }
      }
    },
    select: {
      legacyProjectId: true
    }
  });

  if (!projectV2?.legacyProjectId) {
    return null;
  }

  const legacyProject = await prisma.project.findFirst({
    where: {
      id: projectV2.legacyProjectId,
      userId: params.userId
    },
    select: {
      id: true
    }
  });

  return legacyProject?.id ?? null;
}
