import { prisma } from "./prisma";

export async function requireOwnedProject(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId
    },
    include: {
      template: true
    }
  });

  if (!project) {
    throw new Error("Project not found");
  }

  return project;
}
