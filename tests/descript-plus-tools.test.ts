import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("descript+ tools", () => {
  it("builds deterministic search-replace operations for matching transcript segments", async () => {
    const { buildSearchReplaceOperations } = await import("@/lib/transcript/document");
    const built = buildSearchReplaceOperations({
      segments: [
        { id: "s1", text: "this is a test sentence", startMs: 0, endMs: 1000, confidenceAvg: 0.95 },
        { id: "s2", text: "no replacement needed", startMs: 1200, endMs: 1800, confidenceAvg: 0.92 }
      ],
      search: "test",
      replace: "strong",
      caseSensitive: false,
      maxSegments: 10
    });

    expect(built.operations).toHaveLength(1);
    expect(built.matches[0]?.segmentId).toBe("s1");
    expect(built.matches[0]?.after).toContain("strong sentence");
  });

  it("computes parity scorecard module outcomes from aggregate counters", async () => {
    const { buildParityScorecardModules } = await import("@/lib/parity/scorecard");
    const modules = buildParityScorecardModules({
      studioRoomCount: 2,
      recordingRecoveryCount: 1,
      transcriptSegmentCount: 100,
      checkpointCount: 3,
      audioRunCount: 5,
      autopilotSessionCount: 4,
      reviewDecisionCount: 2,
      publishDoneCount: 8,
      publishTotalCount: 10,
      renderDoneCount: 20,
      renderTotalCount: 21,
      aiDoneCount: 18,
      aiTotalCount: 20
    });

    const reliability = modules.find((module) => module.module === "reliability");
    const publishing = modules.find((module) => module.module === "publishing");
    expect(reliability?.passed).toBe(true);
    expect(publishing?.score).toBeGreaterThanOrEqual(80);
  });

  it("enforces schema contracts for studio, autopilot, review, and publish flows", async () => {
    const { StudioJoinTokenSchema } = await import("@/lib/studio/rooms");
    const { AutopilotApplySchema } = await import("@/lib/autopilot");
    const { ReviewRequestCreateSchema, ReviewRequestDecisionSchema } = await import("@/lib/review-requests");
    const { PublishBatchExportSchema, PublishConnectorSchema, PublishExportSchema } = await import("@/lib/publish/connectors");

    expect(() =>
      StudioJoinTokenSchema.parse({
        participantName: "Host",
        role: "HOST",
        ttlSec: 3600
      })
    ).not.toThrow();
    expect(() =>
      StudioJoinTokenSchema.parse({
        participantName: "Producer",
        role: "PRODUCER",
        pushToTalk: true,
        ttlSec: 1800
      })
    ).not.toThrow();
    expect(() =>
      StudioJoinTokenSchema.parse({
        participantName: "x",
        ttlSec: 10
      })
    ).toThrow();

    expect(() =>
      AutopilotApplySchema.parse({
        sessionId: "sess_123",
        planRevisionHash: "abc12345",
        confirmed: true
      })
    ).not.toThrow();
    expect(() =>
      AutopilotApplySchema.parse({
        sessionId: "sess_123",
        planRevisionHash: "abc12345",
        confirmed: false
      })
    ).toThrow();

    expect(() =>
      ReviewRequestCreateSchema.parse({
        title: "Final review",
        requiredScopes: ["APPROVE"],
        approvalChain: [
          { role: "ADMIN", order: 1 },
          { role: "OWNER", order: 2 }
        ]
      })
    ).not.toThrow();
    expect(() =>
      ReviewRequestDecisionSchema.parse({
        status: "APPROVED",
        note: "Ship it",
        approvalChainStepId: "approval_admin_primary"
      })
    ).not.toThrow();

    expect(PublishConnectorSchema.parse("package")).toBe("package");
    expect(() =>
      PublishExportSchema.parse({
        title: "Launch export",
        visibility: "private",
        distributionPreset: {
          name: "YouTube Growth",
          connector: "youtube",
          visibility: "unlisted"
        },
        metadataPack: {
          name: "SEO defaults",
          metadata: {
            categoryId: "22"
          }
        }
      })
    ).not.toThrow();
    expect(() =>
      PublishBatchExportSchema.parse({
        connectors: ["youtube", "package"],
        baseInput: {
          title: "Batch export"
        },
        byConnector: {
          youtube: {
            visibility: "unlisted"
          }
        }
      })
    ).not.toThrow();
  });
});
