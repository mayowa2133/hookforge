import { beforeAll, describe, expect, it } from "vitest";

let computeConsecutivePassDays: typeof import("@/lib/parity/certification").computeConsecutivePassDays;
let DescriptDiffRecordSchema: typeof import("@/lib/parity/certification").DescriptDiffRecordSchema;
let Phase6PilotFeedbackSchema: typeof import("@/lib/parity/certification").Phase6PilotFeedbackSchema;
let ReleaseCandidateFreezeSchema: typeof import("@/lib/parity/certification").ReleaseCandidateFreezeSchema;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.SESSION_SECRET = "test-session-secret-1234";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test?schema=public";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_ACCESS_KEY = "test";
  process.env.S3_SECRET_KEY = "test";
  process.env.S3_BUCKET = "test";

  const certification = await import("@/lib/parity/certification");
  computeConsecutivePassDays = certification.computeConsecutivePassDays;
  DescriptDiffRecordSchema = certification.DescriptDiffRecordSchema;
  Phase6PilotFeedbackSchema = certification.Phase6PilotFeedbackSchema;
  ReleaseCandidateFreezeSchema = certification.ReleaseCandidateFreezeSchema;
});

function utcDate(input: string) {
  return new Date(`${input}T00:00:00.000Z`);
}

describe("phase6 certification tools", () => {
  it("computes consecutive pass streaks from latest run per day", () => {
    const streak = computeConsecutivePassDays(
      [
        { createdAt: utcDate("2026-02-24"), passed: true },
        { createdAt: utcDate("2026-02-25"), passed: false },
        { createdAt: new Date("2026-02-25T20:00:00.000Z"), passed: true },
        { createdAt: utcDate("2026-02-26"), passed: true }
      ],
      utcDate("2026-02-26")
    );

    expect(streak).toBe(3);
  });

  it("breaks streak when a day is missing or failed", () => {
    const streak = computeConsecutivePassDays(
      [
        { createdAt: utcDate("2026-02-24"), passed: true },
        { createdAt: utcDate("2026-02-26"), passed: true }
      ],
      utcDate("2026-02-26")
    );

    expect(streak).toBe(1);
  });

  it("normalizes and validates descript diff records", () => {
    const parsed = DescriptDiffRecordSchema.parse({
      comparisonMonth: "2026-02",
      discoveredFeatures: [{ title: "New cut style", changeType: "added" }],
      unresolvedDriftCount: "0"
    });

    expect(parsed.source).toBe("manual");
    expect(parsed.discoveredFeatures[0]?.status).toBe("mapped");
    expect(parsed.unresolvedDriftCount).toBe(0);
  });

  it("validates phase6 pilot feedback and release-candidate freeze payloads", () => {
    const feedback = Phase6PilotFeedbackSchema.parse({
      cohort: "dogfood",
      sessionId: "session-123",
      workflowSuccessPct: 100,
      blockerCount: 0,
      crashCount: 0,
      participantCount: 2,
      rating: 5
    });
    const freeze = ReleaseCandidateFreezeSchema.parse({
      releaseTag: "rc-2026-02-26",
      notes: "freeze for two-week pilot"
    });

    expect(feedback.cohort).toBe("dogfood");
    expect(freeze.releaseTag).toBe("rc-2026-02-26");
  });
});
