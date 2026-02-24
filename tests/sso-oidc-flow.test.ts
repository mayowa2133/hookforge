import { describe, expect, it } from "vitest";

describe("sso oidc helpers", () => {
  it("builds authorization URL with required query params", async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-123456";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://localhost/test";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9000";
    process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
    process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY || "minioadmin";
    process.env.S3_BUCKET = process.env.S3_BUCKET || "hookforge";
    const { buildOidcAuthorizationUrl } = await import("@/lib/sso");

    const url = buildOidcAuthorizationUrl({
      provider: {
        issuerUrl: "https://idp.example.com",
        authorizationEndpoint: null,
        clientId: "hookforge-web"
      },
      state: "state123",
      nonce: "nonce123",
      codeChallenge: "challenge123"
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://idp.example.com");
    expect(parsed.pathname).toContain("/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("hookforge-web");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("state")).toBe("state123");
    expect(parsed.searchParams.get("nonce")).toBe("nonce123");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge123");
  });
});
