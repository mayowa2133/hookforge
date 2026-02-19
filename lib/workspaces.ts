import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { env } from "./env";

function toSlug(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function defaultWorkspaceName(email: string) {
  const handle = email.split("@")[0] || "creator";
  return `${handle} studio`;
}

export async function ensurePersonalWorkspace(userId: string, email: string) {
  const existingMembership = await prisma.workspaceMember.findFirst({
    where: {
      userId,
      role: "OWNER"
    },
    include: {
      workspace: {
        include: {
          creditWallet: true
        }
      }
    }
  });

  if (existingMembership?.workspace) {
    if (!existingMembership.workspace.creditWallet) {
      await prisma.creditWallet.upsert({
        where: { workspaceId: existingMembership.workspace.id },
        update: {},
        create: {
          workspaceId: existingMembership.workspace.id,
          balance: env.STARTER_CREDITS
        }
      });
    }
    return existingMembership.workspace;
  }

  const workspaceName = defaultWorkspaceName(email);
  const slugBase = toSlug(workspaceName) || "workspace";
  const slug = `${slugBase}-${randomUUID().slice(0, 6)}`;

  const workspace = await prisma.workspace.create({
    data: {
      name: workspaceName,
      slug,
      ownerId: userId,
      members: {
        create: {
          userId,
          role: "OWNER"
        }
      },
      creditWallet: {
        create: {
          balance: env.STARTER_CREDITS
        }
      }
    }
  });

  return workspace;
}
