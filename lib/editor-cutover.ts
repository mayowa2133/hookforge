import { env } from "./env";

export type EditorCreationMode = "FREEFORM" | "QUICK_START";
export type EditorShell = "LEGACY" | "OPENCUT";
export type OpenCutEditorCohort = "internal" | "beta" | "all";

export type ProjectsV2FeatureFlags = {
  projectsV2Enabled: boolean;
  opencutEditorEnabled: boolean;
  opencutImmediateReplacement: boolean;
  opencutLegacyFallbackAllowlist: string[];
  opencutEditorCohort: OpenCutEditorCohort;
  opencutEditorInternalDomain: string;
  opencutEditorBetaAllowlist: string[];
  aiEditorDefault: boolean;
  showTemplatesNav: boolean;
  quickStartVisible: boolean;
  defaultTemplateSlug: string;
};

export type ProjectsV2EntrypointInput = {
  projectV2Id: string;
  legacyProjectId: string | null;
  userEmail: string;
  flags?: ProjectsV2FeatureFlags;
};

type ProjectsV2FlagSource = {
  ENABLE_PROJECTS_V2: boolean;
  ENABLE_OPENCUT_EDITOR: boolean;
  OPENCUT_IMMEDIATE_REPLACEMENT: boolean;
  OPENCUT_LEGACY_FALLBACK_ALLOWLIST: string;
  OPENCUT_EDITOR_COHORT: OpenCutEditorCohort;
  OPENCUT_EDITOR_INTERNAL_DOMAIN: string;
  OPENCUT_EDITOR_BETA_ALLOWLIST: string;
  NEXT_PUBLIC_AI_EDITOR_DEFAULT: boolean;
  NEXT_PUBLIC_SHOW_TEMPLATES_NAV: boolean;
  NEXT_PUBLIC_QUICK_START_VISIBLE: boolean;
  AI_EDITOR_DEFAULT_TEMPLATE_SLUG: string;
};

export function normalizeEditorCreationMode(input: unknown, fallback: EditorCreationMode = "FREEFORM"): EditorCreationMode {
  if (input === "FREEFORM" || input === "QUICK_START") {
    return input;
  }
  return fallback;
}

export function buildProjectsV2FeatureFlags(source: ProjectsV2FlagSource): ProjectsV2FeatureFlags {
  const betaAllowlist = source.OPENCUT_EDITOR_BETA_ALLOWLIST.split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const legacyFallbackAllowlist = source.OPENCUT_LEGACY_FALLBACK_ALLOWLIST.split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return {
    projectsV2Enabled: source.ENABLE_PROJECTS_V2,
    opencutEditorEnabled: source.ENABLE_OPENCUT_EDITOR,
    opencutImmediateReplacement: source.OPENCUT_IMMEDIATE_REPLACEMENT,
    opencutLegacyFallbackAllowlist: [...new Set(legacyFallbackAllowlist)],
    opencutEditorCohort: source.OPENCUT_EDITOR_COHORT,
    opencutEditorInternalDomain: source.OPENCUT_EDITOR_INTERNAL_DOMAIN.trim().toLowerCase(),
    opencutEditorBetaAllowlist: [...new Set(betaAllowlist)],
    aiEditorDefault: source.NEXT_PUBLIC_AI_EDITOR_DEFAULT,
    showTemplatesNav: source.NEXT_PUBLIC_SHOW_TEMPLATES_NAV,
    quickStartVisible: source.NEXT_PUBLIC_QUICK_START_VISIBLE,
    defaultTemplateSlug: source.AI_EDITOR_DEFAULT_TEMPLATE_SLUG
  };
}

function emailDomain(email: string) {
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1 || atIndex === email.length - 1) {
    return "";
  }
  return email.slice(atIndex + 1).toLowerCase();
}

export function isOpenCutEditorEnabledForEmail(email: string, flags: ProjectsV2FeatureFlags): boolean {
  if (!flags.opencutEditorEnabled) {
    return false;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  if (flags.opencutLegacyFallbackAllowlist.includes(normalizedEmail)) {
    return false;
  }

  if (flags.opencutImmediateReplacement) {
    return true;
  }

  if (flags.opencutEditorCohort === "all") {
    return true;
  }

  if (flags.opencutEditorCohort === "internal") {
    return emailDomain(normalizedEmail) === flags.opencutEditorInternalDomain;
  }

  return flags.opencutEditorBetaAllowlist.includes(normalizedEmail);
}

export function resolveProjectsV2EditorShell(email: string, flags: ProjectsV2FeatureFlags = projectsV2FeatureFlags): EditorShell {
  return isOpenCutEditorEnabledForEmail(email, flags) ? "OPENCUT" : "LEGACY";
}

export function buildProjectsV2EntrypointPath(input: ProjectsV2EntrypointInput) {
  const flags = input.flags ?? projectsV2FeatureFlags;
  const shell = resolveProjectsV2EditorShell(input.userEmail, flags);
  if (shell === "OPENCUT") {
    return `/opencut/projects-v2/${input.projectV2Id}`;
  }
  return `/projects-v2/${input.projectV2Id}`;
}

export const projectsV2FeatureFlags = buildProjectsV2FeatureFlags(env);
