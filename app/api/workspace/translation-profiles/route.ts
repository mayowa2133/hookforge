import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { isSupportedLanguage } from "@/lib/languages";
import { jsonError, jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_TRANSLATION_TONE,
  normalizeGlossary,
  normalizeProfileName,
  setWorkspaceDefaultTranslationProfile
} from "@/lib/translation-profiles";
import { isAtLeastRole } from "@/lib/workspace-roles";

export const runtime = "nodejs";

const CreateProfileSchema = z.object({
  name: z.string().min(2).max(80),
  sourceLanguage: z.string().min(2).max(12).default("en"),
  tone: z.string().max(120).optional(),
  glossary: z.record(z.unknown()).optional(),
  isDefault: z.boolean().default(false)
});

async function requireProfileEditor(workspaceId: string, userId: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId
      }
    }
  });

  if (!membership || !isAtLeastRole(membership.role, "EDITOR")) {
    throw new Error("Unauthorized");
  }

  return membership;
}

export async function GET() {
  try {
    const { workspace } = await requireUserWithWorkspace();

    const profiles = await prisma.translationProfile.findMany({
      where: {
        workspaceId: workspace.id
      },
      orderBy: [
        { isDefault: "desc" },
        { sourceLanguage: "asc" },
        { name: "asc" }
      ]
    });

    return jsonOk({
      workspaceId: workspace.id,
      profiles
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    await requireProfileEditor(workspace.id, user.id);

    const body = CreateProfileSchema.parse(await request.json());
    const sourceLanguage = body.sourceLanguage.trim().toLowerCase();
    if (!isSupportedLanguage(sourceLanguage)) {
      return jsonError(`Unsupported source language: ${body.sourceLanguage}`, 400);
    }

    const profile = await prisma.translationProfile.create({
      data: {
        workspaceId: workspace.id,
        name: normalizeProfileName(body.name),
        sourceLanguage,
        tone: body.tone?.trim() || DEFAULT_TRANSLATION_TONE,
        glossary: normalizeGlossary(body.glossary),
        isDefault: body.isDefault
      }
    });

    if (profile.isDefault) {
      await setWorkspaceDefaultTranslationProfile({
        workspaceId: workspace.id,
        sourceLanguage,
        profileId: profile.id
      });
    }

    return jsonOk({ profile }, 201);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
