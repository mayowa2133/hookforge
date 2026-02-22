import { beforeAll, describe, expect, it } from "vitest";

let buildProjectsV2FeatureFlags: typeof import("@/lib/editor-cutover").buildProjectsV2FeatureFlags;
let normalizeEditorCreationMode: typeof import("@/lib/editor-cutover").normalizeEditorCreationMode;

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
      NEXT_PUBLIC_AI_EDITOR_DEFAULT: false,
      NEXT_PUBLIC_SHOW_TEMPLATES_NAV: true,
      AI_EDITOR_DEFAULT_TEMPLATE_SLUG: "green-screen-commentator"
    });

    expect(flags.projectsV2Enabled).toBe(true);
    expect(flags.aiEditorDefault).toBe(false);
    expect(flags.showTemplatesNav).toBe(true);
    expect(flags.defaultTemplateSlug).toBe("green-screen-commentator");
  });
});
