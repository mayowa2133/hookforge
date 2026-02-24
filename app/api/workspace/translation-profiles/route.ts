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

const CreateProfileSchema = z.object({
  name: z.string().min(2).max(80),
  sourceLanguage: z.string().min(2).max(12).default("en"),
  tone: z.string().max(120).optional(),
  glossary: z.record(z.unknown()).optional(),
  isDefault: z.boolean().default(false)
});

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "translation_profiles.read",
      request
    });

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
    const { workspace } = await requireWorkspaceCapability({
      capability: "translation_profiles.write",
      request
    });

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
