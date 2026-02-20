import { Prisma } from "@prisma/client";
import { sanitizeOverlayText } from "@/lib/sanitize";
import { prisma } from "@/lib/prisma";
import { isSupportedLanguage } from "@/lib/languages";

const MAX_GLOSSARY_ENTRIES = 200;
const MAX_GLOSSARY_KEY_LENGTH = 40;
const MAX_GLOSSARY_VALUE_LENGTH = 120;

export const DEFAULT_TRANSLATION_TONE = "neutral";

export type GlossaryMap = Record<string, string>;

export type ResolvedTranslationProfile = {
  profileId: string | null;
  profileName: string | null;
  sourceLanguage: string;
  tone: string;
  glossary: GlossaryMap;
};

function safeLower(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeGlossary(input: Record<string, unknown> | null | undefined): GlossaryMap {
  if (!input) {
    return {};
  }

  const normalized: GlossaryMap = {};

  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (Object.keys(normalized).length >= MAX_GLOSSARY_ENTRIES) {
      break;
    }

    const key = sanitizeOverlayText(safeLower(rawKey), "").slice(0, MAX_GLOSSARY_KEY_LENGTH);
    if (!key) {
      continue;
    }

    const value = sanitizeOverlayText(String(rawValue ?? ""), "").slice(0, MAX_GLOSSARY_VALUE_LENGTH);
    if (!value) {
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

export function mergeGlossaries(base: GlossaryMap, override: GlossaryMap) {
  return {
    ...base,
    ...override
  };
}

function normalizeTone(tone: string | undefined | null) {
  const safe = sanitizeOverlayText(String(tone ?? ""), "").trim();
  return safe || DEFAULT_TRANSLATION_TONE;
}

export function normalizeProfileName(name: string) {
  return sanitizeOverlayText(name, "translation profile").slice(0, 80);
}

function normalizeSourceLanguage(language: string) {
  const normalized = safeLower(language);
  return isSupportedLanguage(normalized) ? normalized : "en";
}

export async function resolveWorkspaceTranslationProfile(params: {
  workspaceId: string;
  profileId?: string | null;
  sourceLanguage: string;
  tone?: string;
  glossary?: Record<string, unknown>;
}) {
  const normalizedSourceLanguage = normalizeSourceLanguage(params.sourceLanguage);
  const runtimeTone = normalizeTone(params.tone);
  const runtimeGlossary = normalizeGlossary(params.glossary);

  let profile = null as
    | {
        id: string;
        name: string;
        sourceLanguage: string;
        tone: string;
        glossary: Prisma.JsonValue;
      }
    | null;

  if (params.profileId) {
    profile = await prisma.translationProfile.findFirst({
      where: {
        id: params.profileId,
        workspaceId: params.workspaceId
      },
      select: {
        id: true,
        name: true,
        sourceLanguage: true,
        tone: true,
        glossary: true
      }
    });

    if (!profile) {
      throw new Error("Translation profile not found");
    }
  }

  if (!profile) {
    profile = await prisma.translationProfile.findFirst({
      where: {
        workspaceId: params.workspaceId,
        sourceLanguage: normalizedSourceLanguage,
        isDefault: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      select: {
        id: true,
        name: true,
        sourceLanguage: true,
        tone: true,
        glossary: true
      }
    });
  }

  const profileGlossary = normalizeGlossary((profile?.glossary as Record<string, unknown> | null) ?? {});
  const mergedGlossary = mergeGlossaries(profileGlossary, runtimeGlossary);

  return {
    profileId: profile?.id ?? null,
    profileName: profile?.name ?? null,
    sourceLanguage: normalizedSourceLanguage,
    tone: runtimeTone || profile?.tone || DEFAULT_TRANSLATION_TONE,
    glossary: mergedGlossary
  } satisfies ResolvedTranslationProfile;
}

export async function setWorkspaceDefaultTranslationProfile(params: {
  workspaceId: string;
  sourceLanguage: string;
  profileId: string;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.translationProfile.updateMany({
      where: {
        workspaceId: params.workspaceId,
        sourceLanguage: params.sourceLanguage,
        isDefault: true
      },
      data: {
        isDefault: false
      }
    });

    await tx.translationProfile.update({
      where: {
        id: params.profileId
      },
      data: {
        isDefault: true
      }
    });
  });
}

export async function ensureDefaultWorkspaceTranslationProfile(workspaceId: string) {
  const existing = await prisma.translationProfile.findFirst({
    where: {
      workspaceId,
      sourceLanguage: "en",
      isDefault: true
    },
    select: {
      id: true
    }
  });

  if (existing) {
    return existing.id;
  }

  const profile = await prisma.translationProfile.create({
    data: {
      workspaceId,
      name: "Default English",
      sourceLanguage: "en",
      tone: DEFAULT_TRANSLATION_TONE,
      glossary: {},
      isDefault: true
    }
  });

  return profile.id;
}
