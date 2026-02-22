import { env } from "./env";

export type EditorCreationMode = "FREEFORM" | "QUICK_START";

export type ProjectsV2FeatureFlags = {
  projectsV2Enabled: boolean;
  aiEditorDefault: boolean;
  showTemplatesNav: boolean;
  defaultTemplateSlug: string;
};

type ProjectsV2FlagSource = {
  ENABLE_PROJECTS_V2: boolean;
  NEXT_PUBLIC_AI_EDITOR_DEFAULT: boolean;
  NEXT_PUBLIC_SHOW_TEMPLATES_NAV: boolean;
  AI_EDITOR_DEFAULT_TEMPLATE_SLUG: string;
};

export function normalizeEditorCreationMode(input: unknown, fallback: EditorCreationMode = "FREEFORM"): EditorCreationMode {
  if (input === "FREEFORM" || input === "QUICK_START") {
    return input;
  }
  return fallback;
}

export function buildProjectsV2FeatureFlags(source: ProjectsV2FlagSource): ProjectsV2FeatureFlags {
  return {
    projectsV2Enabled: source.ENABLE_PROJECTS_V2,
    aiEditorDefault: source.NEXT_PUBLIC_AI_EDITOR_DEFAULT,
    showTemplatesNav: source.NEXT_PUBLIC_SHOW_TEMPLATES_NAV,
    defaultTemplateSlug: source.AI_EDITOR_DEFAULT_TEMPLATE_SLUG
  };
}

export const projectsV2FeatureFlags = buildProjectsV2FeatureFlags(env);
