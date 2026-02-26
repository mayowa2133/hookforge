import { prisma } from "@/lib/prisma";

const DEFAULT_RELEASE_WORKSPACE_SLUG = "hookforge-descript-release";
const DEFAULT_RELEASE_WORKSPACE_NAME = "HookForge Descript Release";
const DEFAULT_RELEASE_OWNER_EMAIL = "parity-release-bot@hookforge.local";
const DEFAULT_RELEASE_OWNER_PASSWORD = "parity-release-bot-password";

function boolFromEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
}

export function getReleaseWorkspaceSlug() {
  return process.env.PARITY_RELEASE_WORKSPACE_SLUG?.trim() || DEFAULT_RELEASE_WORKSPACE_SLUG;
}

export function getReleaseWorkspaceName() {
  return process.env.PARITY_RELEASE_WORKSPACE_NAME?.trim() || DEFAULT_RELEASE_WORKSPACE_NAME;
}

export function getReleaseOwnerEmail() {
  return (process.env.PARITY_RELEASE_OWNER_EMAIL?.trim().toLowerCase() || DEFAULT_RELEASE_OWNER_EMAIL);
}

export function shouldWriteParityEnvFile() {
  return boolFromEnv(process.env.PARITY_RELEASE_WRITE_ENV_FILE, true);
}

export async function resolveReleaseWorkspace() {
  const explicitWorkspaceId = process.env.PARITY_WORKSPACE_ID?.trim();
  if (explicitWorkspaceId) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: explicitWorkspaceId },
      select: { id: true, slug: true, name: true, ownerId: true }
    });
    if (!workspace) {
      throw new Error(`Workspace '${explicitWorkspaceId}' not found.`);
    }
    return {
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      ownerId: workspace.ownerId,
      source: "PARITY_WORKSPACE_ID" as const
    };
  }

  const slug = getReleaseWorkspaceSlug();
  const existing = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, ownerId: true }
  });
  if (existing) {
    return {
      workspaceId: existing.id,
      workspaceSlug: existing.slug,
      workspaceName: existing.name,
      ownerId: existing.ownerId,
      source: "existing_slug" as const
    };
  }

  const ownerEmail = getReleaseOwnerEmail();
  let owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: { id: true, email: true }
  });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash: process.env.PARITY_RELEASE_OWNER_PASSWORD?.trim() || DEFAULT_RELEASE_OWNER_PASSWORD
      },
      select: { id: true, email: true }
    });
  }

  const workspace = await prisma.workspace.create({
    data: {
      slug,
      name: getReleaseWorkspaceName(),
      ownerId: owner.id
    },
    select: { id: true, slug: true, name: true, ownerId: true }
  });

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: owner.id
      }
    },
    update: {
      role: "OWNER"
    },
    create: {
      workspaceId: workspace.id,
      userId: owner.id,
      role: "OWNER"
    }
  });

  return {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    workspaceName: workspace.name,
    ownerId: workspace.ownerId,
    source: "created" as const
  };
}

export async function resolveWorkspaceActorUserId(workspaceId: string) {
  const explicit = process.env.PARITY_RELEASE_ACTOR_USER_ID?.trim();
  if (explicit) {
    return explicit;
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true }
  });
  if (workspace?.ownerId) {
    return workspace.ownerId;
  }

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: { userId: true }
  });
  if (membership?.userId) {
    return membership.userId;
  }

  throw new Error(`No actor user found for workspace '${workspaceId}'.`);
}

export function currentMonthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function buildReleaseEvidenceId(workspaceId: string, key: string) {
  return `parity-release-${key}-${workspaceId}`;
}
