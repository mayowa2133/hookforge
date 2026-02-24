import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { isSupportedLanguage } from "@/lib/languages";
import { jsonError, jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_TRANSLATION_TONE,
  normalizeGlossary,
  normalizeProfileName,
  setWorkspaceDefaultTranslationProfile
} from "@/lib/translation-profiles";

export const runtime = "nodejs";

type Context = {
  params: {
    profileId: string;
  };
};

const UpdateProfileSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  sourceLanguage: z.string().min(2).max(12).optional(),
  tone: z.string().max(120).optional(),
  glossary: z.record(z.unknown()).optional(),
  isDefault: z.boolean().optional()
});

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "translation_profiles.write",
      request
    });

    const body = UpdateProfileSchema.parse(await request.json());

    const profile = await prisma.translationProfile.findFirst({
      where: {
        id: params.profileId,
        workspaceId: workspace.id
      }
    });

    if (!profile) {
      return jsonError("Translation profile not found", 404);
    }

    const sourceLanguage = body.sourceLanguage ? body.sourceLanguage.trim().toLowerCase() : profile.sourceLanguage;
    if (!isSupportedLanguage(sourceLanguage)) {
      return jsonError(`Unsupported source language: ${sourceLanguage}`, 400);
    }

    const updated = await prisma.translationProfile.update({
      where: {
        id: profile.id
      },
      data: {
        name: body.name ? normalizeProfileName(body.name) : undefined,
        sourceLanguage,
        tone: body.tone?.trim() || (body.tone ? DEFAULT_TRANSLATION_TONE : undefined),
        glossary: body.glossary ? normalizeGlossary(body.glossary) : undefined,
        isDefault: body.isDefault
      }
    });

    if (updated.isDefault) {
      await setWorkspaceDefaultTranslationProfile({
        workspaceId: workspace.id,
        sourceLanguage: updated.sourceLanguage,
        profileId: updated.id
      });
    }

    return jsonOk({ profile: updated });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "translation_profiles.write",
      request
    });

    const profile = await prisma.translationProfile.findFirst({
      where: {
        id: params.profileId,
        workspaceId: workspace.id
      }
    });

    if (!profile) {
      return jsonError("Translation profile not found", 404);
    }

    await prisma.translationProfile.delete({
      where: {
        id: profile.id
      }
    });

    return jsonOk({ removedProfileId: profile.id });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
