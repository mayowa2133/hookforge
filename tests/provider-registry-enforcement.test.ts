import { afterEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;

function seedRequiredEnv() {
  process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
  process.env.SESSION_SECRET ??= "test-secret-1234567890";
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  process.env.S3_ENDPOINT ??= "http://localhost:9000";
  process.env.S3_ACCESS_KEY ??= "minioadmin";
  process.env.S3_SECRET_KEY ??= "minioadmin";
  process.env.S3_BUCKET ??= "hookforge-test";
  process.env.ALLOW_MOCK_PROVIDERS ??= "false";
}

async function importRegistry() {
  vi.resetModules();
  seedRequiredEnv();
  return import("@/lib/providers/registry");
}

afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = originalNodeEnv;
});

describe("provider registry enforcement", () => {
  it("allows mock providers when NODE_ENV is unset", async () => {
    delete (process.env as Record<string, string | undefined>).NODE_ENV;
    const { assertProviderAllowed } = await importRegistry();

    expect(() =>
      assertProviderAllowed(
        {
          name: "deterministic-fallback",
          capability: "translation",
          configured: true,
          isMock: true,
          supportsOperations: ["*"],
          run: async () => ({
            providerName: "deterministic-fallback",
            output: {}
          })
        },
        "translation"
      )
    ).not.toThrow();
  });

  it("allows mock providers in test runtime", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    const { assertProviderAllowed } = await importRegistry();

    expect(() =>
      assertProviderAllowed(
        {
          name: "deterministic-fallback",
          capability: "translation",
          configured: true,
          isMock: true,
          supportsOperations: ["*"],
          run: async () => ({
            providerName: "deterministic-fallback",
            output: {}
          })
        },
        "translation"
      )
    ).not.toThrow();
  });

  it("blocks mock provider selection in production runtime", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const { assertProviderAllowed } = await importRegistry();

    expect(() =>
      assertProviderAllowed(
        {
          name: "deterministic-fallback",
          capability: "translation",
          configured: true,
          isMock: true,
          supportsOperations: ["*"],
          run: async () => ({
            providerName: "deterministic-fallback",
            output: {}
          })
        },
        "translation"
      )
    ).toThrow(/Mock provider/);
  });

  it("reports capability readiness rows", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    const { summarizeProviderReadiness } = await importRegistry();
    const summary = summarizeProviderReadiness();

    expect(summary.rows.length).toBeGreaterThanOrEqual(7);
    expect(summary.rows.every((row) => typeof row.capability === "string")).toBe(true);
  });
});
