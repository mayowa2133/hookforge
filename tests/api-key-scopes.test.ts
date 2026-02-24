import { describe, expect, it } from "vitest";

async function loadScopeHelpers() {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-123456";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://localhost/test";
  process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
  process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9000";
  process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
  process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY || "minioadmin";
  process.env.S3_BUCKET = process.env.S3_BUCKET || "hookforge";
  return import("@/lib/enterprise-security");
}

describe("api key scopes", () => {
  it("normalizes known scopes and keeps defaults", async () => {
    const { normalizePublicApiScopes } = await loadScopeHelpers();
    const normalized = normalizePublicApiScopes(["translate.submit", "translate.status", "invalid.scope"]);
    expect(normalized).toContain("translate.submit");
    expect(normalized).toContain("translate.status");
    expect(normalized).not.toContain("invalid.scope");
  });

  it("supports wildcard access", async () => {
    const { hasApiScope } = await loadScopeHelpers();
    expect(hasApiScope(["translate.all"], "translate.estimate")).toBe(true);
    expect(hasApiScope(["translate.all"], "translate.submit")).toBe(true);
  });

  it("denies unsupported scope accesses", async () => {
    const { hasApiScope } = await loadScopeHelpers();
    expect(hasApiScope(["translate.read"], "translate.submit")).toBe(false);
  });
});
