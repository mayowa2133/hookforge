import { beforeAll, describe, expect, it } from "vitest";

let buildProjectsV2FeatureFlags: typeof import("@/lib/editor-cutover").buildProjectsV2FeatureFlags;
let normalizeEditorCreationMode: typeof import("@/lib/editor-cutover").normalizeEditorCreationMode;
let resolveProjectsV2EditorShell: typeof import("@/lib/editor-cutover").resolveProjectsV2EditorShell;
let buildProjectsV2EntrypointPath: typeof import("@/lib/editor-cutover").buildProjectsV2EntrypointPath;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.SESSION_SECRET = "test-session-secret-1234";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_ACCESS_KEY = "test";
  process.env.S3_SECRET_KEY = "test";
  process.env.S3_BUCKET = "test";

  const cutover = await import("@/lib/editor-cutover");
  buildProjectsV2FeatureFlags = cutover.buildProjectsV2FeatureFlags;
  normalizeEditorCreationMode = cutover.normalizeEditorCreationMode;
  resolveProjectsV2EditorShell = cutover.resolveProjectsV2EditorShell;
  buildProjectsV2EntrypointPath = cutover.buildProjectsV2EntrypointPath;
});

describe("editor cutover feature flags", () => {
  it("normalizes editor creation modes with fallback", () => {
    expect(normalizeEditorCreationMode("FREEFORM")).toBe("FREEFORM");
    expect(normalizeEditorCreationMode("QUICK_START")).toBe("QUICK_START");
    expect(normalizeEditorCreationMode("something-else")).toBe("FREEFORM");
    expect(normalizeEditorCreationMode(undefined, "QUICK_START")).toBe("QUICK_START");
  });

  it("builds projects-v2 feature flags from source", () => {
    const flags = buildProjectsV2FeatureFlags({
      ENABLE_PROJECTS_V2: true,
      ENABLE_OPENCUT_EDITOR: true,
      DESCRIPT_PLUS_ROLLOUT_STAGE: "global",
      DESCRIPT_PLUS_ROLLOUT_ALLOWLIST: "",
      DESCRIPT_PLUS_INTERNAL_DOMAIN: "hookforge.dev",
      DESCRIPT_PLUS_AUTO_ROLLBACK: true,
      DESCRIPT_PLUS_FORCE_ROLLBACK_TO_LEGACY: false,
      OPENCUT_IMMEDIATE_REPLACEMENT: false,
      OPENCUT_LEGACY_FALLBACK_ALLOWLIST: "",
      OPENCUT_EDITOR_COHORT: "beta",
      OPENCUT_EDITOR_INTERNAL_DOMAIN: "hookforge.dev",
      OPENCUT_EDITOR_BETA_ALLOWLIST: "beta@hookforge.dev,beta2@hookforge.dev",
      NEXT_PUBLIC_AI_EDITOR_DEFAULT: false,
      NEXT_PUBLIC_SHOW_TEMPLATES_NAV: true,
      NEXT_PUBLIC_QUICK_START_VISIBLE: true,
      AI_EDITOR_DEFAULT_TEMPLATE_SLUG: "green-screen-commentator"
    });

    expect(flags.projectsV2Enabled).toBe(true);
    expect(flags.opencutEditorEnabled).toBe(true);
    expect(flags.opencutImmediateReplacement).toBe(false);
    expect(flags.opencutLegacyFallbackAllowlist).toEqual([]);
    expect(flags.opencutEditorCohort).toBe("beta");
    expect(flags.opencutEditorInternalDomain).toBe("hookforge.dev");
    expect(flags.opencutEditorBetaAllowlist).toEqual(["beta@hookforge.dev", "beta2@hookforge.dev"]);
    expect(flags.aiEditorDefault).toBe(false);
    expect(flags.showTemplatesNav).toBe(true);
    expect(flags.quickStartVisible).toBe(true);
    expect(flags.defaultTemplateSlug).toBe("green-screen-commentator");
  });

  it("resolves editor shell based on immediate replacement and fallback allowlist", () => {
    const defaultFlags = buildProjectsV2FeatureFlags({
      ENABLE_PROJECTS_V2: true,
      ENABLE_OPENCUT_EDITOR: true,
      DESCRIPT_PLUS_ROLLOUT_STAGE: "global",
      DESCRIPT_PLUS_ROLLOUT_ALLOWLIST: "",
      DESCRIPT_PLUS_INTERNAL_DOMAIN: "hookforge.dev",
      DESCRIPT_PLUS_AUTO_ROLLBACK: true,
      DESCRIPT_PLUS_FORCE_ROLLBACK_TO_LEGACY: false,
      OPENCUT_IMMEDIATE_REPLACEMENT: true,
      OPENCUT_LEGACY_FALLBACK_ALLOWLIST: "",
      OPENCUT_EDITOR_COHORT: "internal",
      OPENCUT_EDITOR_INTERNAL_DOMAIN: "hookforge.dev",
      OPENCUT_EDITOR_BETA_ALLOWLIST: "",
      NEXT_PUBLIC_AI_EDITOR_DEFAULT: true,
      NEXT_PUBLIC_SHOW_TEMPLATES_NAV: false,
      NEXT_PUBLIC_QUICK_START_VISIBLE: true,
      AI_EDITOR_DEFAULT_TEMPLATE_SLUG: "green-screen-commentator"
    });
    expect(resolveProjectsV2EditorShell("dev@hookforge.dev", defaultFlags)).toBe("OPENCUT");
    expect(resolveProjectsV2EditorShell("user@example.com", defaultFlags)).toBe("OPENCUT");

    const fallbackFlags = buildProjectsV2FeatureFlags({
      ENABLE_PROJECTS_V2: true,
      ENABLE_OPENCUT_EDITOR: true,
      DESCRIPT_PLUS_ROLLOUT_STAGE: "global",
      DESCRIPT_PLUS_ROLLOUT_ALLOWLIST: "",
      DESCRIPT_PLUS_INTERNAL_DOMAIN: "hookforge.dev",
      DESCRIPT_PLUS_AUTO_ROLLBACK: true,
      DESCRIPT_PLUS_FORCE_ROLLBACK_TO_LEGACY: false,
      OPENCUT_IMMEDIATE_REPLACEMENT: true,
      OPENCUT_LEGACY_FALLBACK_ALLOWLIST: "legacy@example.com",
      OPENCUT_EDITOR_COHORT: "all",
      OPENCUT_EDITOR_INTERNAL_DOMAIN: "hookforge.dev",
      OPENCUT_EDITOR_BETA_ALLOWLIST: "",
      NEXT_PUBLIC_AI_EDITOR_DEFAULT: true,
      NEXT_PUBLIC_SHOW_TEMPLATES_NAV: false,
      NEXT_PUBLIC_QUICK_START_VISIBLE: true,
      AI_EDITOR_DEFAULT_TEMPLATE_SLUG: "green-screen-commentator"
    });
    expect(resolveProjectsV2EditorShell("legacy@example.com", fallbackFlags)).toBe("LEGACY");
    expect(resolveProjectsV2EditorShell("creator@example.com", fallbackFlags)).toBe("OPENCUT");

    const internalFlags = buildProjectsV2FeatureFlags({
      ENABLE_PROJECTS_V2: true,
      ENABLE_OPENCUT_EDITOR: true,
      DESCRIPT_PLUS_ROLLOUT_STAGE: "global",
      DESCRIPT_PLUS_ROLLOUT_ALLOWLIST: "",
      DESCRIPT_PLUS_INTERNAL_DOMAIN: "hookforge.dev",
      DESCRIPT_PLUS_AUTO_ROLLBACK: true,
      DESCRIPT_PLUS_FORCE_ROLLBACK_TO_LEGACY: false,
      OPENCUT_IMMEDIATE_REPLACEMENT: false,
      OPENCUT_LEGACY_FALLBACK_ALLOWLIST: "",
      OPENCUT_EDITOR_COHORT: "internal",
      OPENCUT_EDITOR_INTERNAL_DOMAIN: "hookforge.dev",
      OPENCUT_EDITOR_BETA_ALLOWLIST: "",
      NEXT_PUBLIC_AI_EDITOR_DEFAULT: true,
      NEXT_PUBLIC_SHOW_TEMPLATES_NAV: false,
      NEXT_PUBLIC_QUICK_START_VISIBLE: true,
      AI_EDITOR_DEFAULT_TEMPLATE_SLUG: "green-screen-commentator"
    });
    expect(resolveProjectsV2EditorShell("dev@hookforge.dev", internalFlags)).toBe("OPENCUT");
    expect(resolveProjectsV2EditorShell("user@example.com", internalFlags)).toBe("LEGACY");

    const betaFlags = buildProjectsV2FeatureFlags({
      ENABLE_PROJECTS_V2: true,
      ENABLE_OPENCUT_EDITOR: true,
      DESCRIPT_PLUS_ROLLOUT_STAGE: "global",
      DESCRIPT_PLUS_ROLLOUT_ALLOWLIST: "",
      DESCRIPT_PLUS_INTERNAL_DOMAIN: "hookforge.dev",
      DESCRIPT_PLUS_AUTO_ROLLBACK: true,
      DESCRIPT_PLUS_FORCE_ROLLBACK_TO_LEGACY: false,
      OPENCUT_IMMEDIATE_REPLACEMENT: false,
      OPENCUT_LEGACY_FALLBACK_ALLOWLIST: "",
      OPENCUT_EDITOR_COHORT: "beta",
      OPENCUT_EDITOR_INTERNAL_DOMAIN: "hookforge.dev",
      OPENCUT_EDITOR_BETA_ALLOWLIST: "tester@example.com",
      NEXT_PUBLIC_AI_EDITOR_DEFAULT: true,
      NEXT_PUBLIC_SHOW_TEMPLATES_NAV: false,
      NEXT_PUBLIC_QUICK_START_VISIBLE: true,
      AI_EDITOR_DEFAULT_TEMPLATE_SLUG: "green-screen-commentator"
    });
    expect(resolveProjectsV2EditorShell("tester@example.com", betaFlags)).toBe("OPENCUT");
    expect(resolveProjectsV2EditorShell("other@example.com", betaFlags)).toBe("LEGACY");
  });

  it("builds projects-v2 entrypoint path from shell decision", () => {
    const flags = buildProjectsV2FeatureFlags({
      ENABLE_PROJECTS_V2: true,
      ENABLE_OPENCUT_EDITOR: true,
      DESCRIPT_PLUS_ROLLOUT_STAGE: "global",
      DESCRIPT_PLUS_ROLLOUT_ALLOWLIST: "",
      DESCRIPT_PLUS_INTERNAL_DOMAIN: "hookforge.dev",
      DESCRIPT_PLUS_AUTO_ROLLBACK: true,
      DESCRIPT_PLUS_FORCE_ROLLBACK_TO_LEGACY: false,
      OPENCUT_IMMEDIATE_REPLACEMENT: true,
      OPENCUT_LEGACY_FALLBACK_ALLOWLIST: "",
      OPENCUT_EDITOR_COHORT: "all",
      OPENCUT_EDITOR_INTERNAL_DOMAIN: "hookforge.dev",
      OPENCUT_EDITOR_BETA_ALLOWLIST: "",
      NEXT_PUBLIC_AI_EDITOR_DEFAULT: true,
      NEXT_PUBLIC_SHOW_TEMPLATES_NAV: false,
      NEXT_PUBLIC_QUICK_START_VISIBLE: true,
      AI_EDITOR_DEFAULT_TEMPLATE_SLUG: "green-screen-commentator"
    });

    expect(
      buildProjectsV2EntrypointPath({
        projectV2Id: "pv2_1",
        legacyProjectId: "legacy_1",
        userEmail: "creator@example.com",
        flags
      })
    ).toBe("/opencut/projects-v2/pv2_1");

    expect(
      buildProjectsV2EntrypointPath({
        projectV2Id: "pv2_2",
        legacyProjectId: null,
        userEmail: "creator@example.com",
        flags
      })
    ).toBe("/opencut/projects-v2/pv2_2");
  });

  it("enforces rollout stage allowlists and force rollback fallback", () => {
    const pilotFlags = buildProjectsV2FeatureFlags({
      ENABLE_PROJECTS_V2: true,
      ENABLE_OPENCUT_EDITOR: true,
      DESCRIPT_PLUS_ROLLOUT_STAGE: "pilot",
      DESCRIPT_PLUS_ROLLOUT_ALLOWLIST: "pilot@example.com",
      DESCRIPT_PLUS_INTERNAL_DOMAIN: "hookforge.dev",
      DESCRIPT_PLUS_AUTO_ROLLBACK: true,
      DESCRIPT_PLUS_FORCE_ROLLBACK_TO_LEGACY: false,
      OPENCUT_IMMEDIATE_REPLACEMENT: true,
      OPENCUT_LEGACY_FALLBACK_ALLOWLIST: "",
      OPENCUT_EDITOR_COHORT: "all",
      OPENCUT_EDITOR_INTERNAL_DOMAIN: "hookforge.dev",
      OPENCUT_EDITOR_BETA_ALLOWLIST: "",
      NEXT_PUBLIC_AI_EDITOR_DEFAULT: true,
      NEXT_PUBLIC_SHOW_TEMPLATES_NAV: false,
      NEXT_PUBLIC_QUICK_START_VISIBLE: true,
      AI_EDITOR_DEFAULT_TEMPLATE_SLUG: "green-screen-commentator"
    });

    expect(resolveProjectsV2EditorShell("pilot@example.com", pilotFlags)).toBe("OPENCUT");
    expect(resolveProjectsV2EditorShell("creator@example.com", pilotFlags)).toBe("LEGACY");

    const rollbackFlags = buildProjectsV2FeatureFlags({
      ENABLE_PROJECTS_V2: true,
      ENABLE_OPENCUT_EDITOR: true,
      DESCRIPT_PLUS_ROLLOUT_STAGE: "global",
      DESCRIPT_PLUS_ROLLOUT_ALLOWLIST: "",
      DESCRIPT_PLUS_INTERNAL_DOMAIN: "hookforge.dev",
      DESCRIPT_PLUS_AUTO_ROLLBACK: true,
      DESCRIPT_PLUS_FORCE_ROLLBACK_TO_LEGACY: true,
      OPENCUT_IMMEDIATE_REPLACEMENT: true,
      OPENCUT_LEGACY_FALLBACK_ALLOWLIST: "",
      OPENCUT_EDITOR_COHORT: "all",
      OPENCUT_EDITOR_INTERNAL_DOMAIN: "hookforge.dev",
      OPENCUT_EDITOR_BETA_ALLOWLIST: "",
      NEXT_PUBLIC_AI_EDITOR_DEFAULT: true,
      NEXT_PUBLIC_SHOW_TEMPLATES_NAV: false,
      NEXT_PUBLIC_QUICK_START_VISIBLE: true,
      AI_EDITOR_DEFAULT_TEMPLATE_SLUG: "green-screen-commentator"
    });

    expect(resolveProjectsV2EditorShell("pilot@example.com", rollbackFlags)).toBe("LEGACY");
    expect(resolveProjectsV2EditorShell("creator@example.com", rollbackFlags)).toBe("LEGACY");
  });
});
