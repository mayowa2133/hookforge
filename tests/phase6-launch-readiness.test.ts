import { beforeAll, describe, expect, it } from "vitest";

let evaluateLaunchGuardrails: typeof import("@/lib/parity/launch-readiness").evaluateLaunchGuardrails;
let isEmailEligibleForLaunchStage: typeof import("@/lib/parity/launch-readiness").isEmailEligibleForLaunchStage;
let parseRolloutAllowlist: typeof import("@/lib/parity/launch-readiness").parseRolloutAllowlist;
let summarizeBenchmarkAgainstDescript: typeof import("@/lib/parity/benchmarks").summarizeBenchmarkAgainstDescript;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.SESSION_SECRET = "test-session-secret-1234";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_ACCESS_KEY = "test";
  process.env.S3_SECRET_KEY = "test";
  process.env.S3_BUCKET = "test";

  const launchReadiness = await import("@/lib/parity/launch-readiness");
  evaluateLaunchGuardrails = launchReadiness.evaluateLaunchGuardrails;
  isEmailEligibleForLaunchStage = launchReadiness.isEmailEligibleForLaunchStage;
  parseRolloutAllowlist = launchReadiness.parseRolloutAllowlist;

  const benchmarks = await import("@/lib/parity/benchmarks");
  summarizeBenchmarkAgainstDescript = benchmarks.summarizeBenchmarkAgainstDescript;
});

describe("phase6 launch readiness", () => {
  it("parses rollout allowlists and evaluates stage eligibility", () => {
    const allowlist = parseRolloutAllowlist(" pilot@example.com, pilot@example.com ,creator@example.com ");
    expect(allowlist).toEqual(["pilot@example.com", "creator@example.com"]);

    expect(
      isEmailEligibleForLaunchStage({
        stage: "global",
        email: "any@example.com",
        internalDomain: "hookforge.dev",
        allowlist
      })
    ).toBe(true);
    expect(
      isEmailEligibleForLaunchStage({
        stage: "internal",
        email: "dev@hookforge.dev",
        internalDomain: "hookforge.dev",
        allowlist
      })
    ).toBe(true);
    expect(
      isEmailEligibleForLaunchStage({
        stage: "pilot",
        email: "pilot@example.com",
        internalDomain: "hookforge.dev",
        allowlist
      })
    ).toBe(true);
    expect(
      isEmailEligibleForLaunchStage({
        stage: "small_team",
        email: "other@example.com",
        internalDomain: "hookforge.dev",
        allowlist
      })
    ).toBe(false);
  });

  it("emits rollback guardrail triggers when critical thresholds are breached", () => {
    const triggers = evaluateLaunchGuardrails({
      snapshot: {
        parityScore: 60,
        renderSuccessPct: 94,
        aiSuccessPct: 80,
        queueHealthy: false,
        queueBacklog: 5000,
        queueFailed: 320,
        editorOpenP95Ms: 3200,
        commandP95Ms: 180
      },
      thresholds: {
        minParityScore: 75,
        minRenderSuccessPct: 99,
        minAiSuccessPct: 95,
        maxQueueBacklog: 1200,
        maxQueueFailed: 200,
        maxEditorOpenP95Ms: 2500,
        maxCommandP95Ms: 100
      }
    });

    expect(triggers.length).toBeGreaterThanOrEqual(6);
    expect(triggers.some((trigger) => trigger.code === "PARITY_SCORE_BELOW_MIN")).toBe(true);
    expect(triggers.some((trigger) => trigger.code === "QUEUE_UNHEALTHY")).toBe(true);
    expect(triggers.some((trigger) => trigger.code === "COMMAND_LATENCY_HIGH")).toBe(true);
  });

  it("summarizes benchmark deltas against Descript baseline", () => {
    const summary = summarizeBenchmarkAgainstDescript({
      passThreshold: 70,
      results: [
        { module: "recording", score: 82, passed: true, tier: "Descript parity" },
        { module: "transcript", score: 84, passed: true, tier: "Descript parity" },
        { module: "audio", score: 80, passed: true, tier: "Descript parity" },
        { module: "collaboration", score: 80, passed: true, tier: "Descript parity" },
        { module: "publishing", score: 78, passed: true, tier: "Descript parity" },
        { module: "autopilot", score: 82, passed: true, tier: "Descript+" },
        { module: "reliability", score: 88, passed: true, tier: "Descript+" }
      ]
    });

    expect(summary.parityMet).toBe(true);
    expect(summary.betterThanDescript).toBe(true);
    expect(summary.advantageModules.length).toBeGreaterThanOrEqual(2);
  });
});
