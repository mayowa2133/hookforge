import { describe, expect, it } from "vitest";

describe("sso saml helpers", () => {
  it("builds metadata XML with entity and ACS", async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-123456";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://localhost/test";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9000";
    process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
    process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY || "minioadmin";
    process.env.S3_BUCKET = process.env.S3_BUCKET || "hookforge";
    const { buildSamlMetadataXml, parseSamlAcsPayload } = await import("@/lib/sso");

    const xml = buildSamlMetadataXml({
      entityId: "hookforge-sp",
      acsUrl: "https://app.hookforge.test/api/auth/sso/saml/acs",
      ssoUrl: "https://idp.example.com/sso"
    });

    expect(xml).toContain("EntityDescriptor");
    expect(xml).toContain("hookforge-sp");
    expect(xml).toContain("AssertionConsumerService");
    expect(xml).toContain("https://app.hookforge.test/api/auth/sso/saml/acs");
  });

  it("parses ACS payload into provider subject and email", async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-123456";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://localhost/test";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9000";
    process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
    process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY || "minioadmin";
    process.env.S3_BUCKET = process.env.S3_BUCKET || "hookforge";
    const { parseSamlAcsPayload } = await import("@/lib/sso");

    const parsed = parseSamlAcsPayload({
      nameId: "user-123",
      email: "User@example.com"
    });
    expect(parsed.providerSubject).toBe("user-123");
    expect(parsed.email).toBe("user@example.com");
  });
});
