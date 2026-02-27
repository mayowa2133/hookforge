import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("phase3 studio tools", () => {
  it("resolves template defaults for panel sessions", async () => {
    const { buildStudioRoomTemplateConfig } = await import("@/lib/studio/rooms");
    const template = buildStudioRoomTemplateConfig("panel");
    expect(template.id).toBe("panel");
    expect(template.recordingSafety.enforcePushToTalk).toBe(true);
    expect(template.captureProfile.videoLayout).toBe("grid");
  });

  it("flags failing safety checks when host is missing", async () => {
    const { evaluateStudioRoomSafetyChecks } = await import("@/lib/studio/rooms");
    const safety = evaluateStudioRoomSafetyChecks({
      template: "podcast",
      roomStatus: "ACTIVE",
      participantRoleCounts: {
        HOST: 0,
        PRODUCER: 1,
        GUEST: 1,
        VIEWER: 0
      },
      pushToTalkEnabled: false
    });
    expect(safety.canStartRecording).toBe(false);
    expect(safety.checks.some((check) => check.code === "HOST_PRESENT" && check.status === "FAIL")).toBe(true);
  });

  it("builds deterministic merge plan for studio stop recording", async () => {
    const { buildDeterministicStudioMergePlan } = await import("@/lib/studio/rooms");
    const merge = buildDeterministicStudioMergePlan({
      durationMs: 5600,
      participants: [
        { id: "p-host", displayName: "Host", role: "HOST" },
        { id: "p-guest", displayName: "Guest", role: "GUEST" },
        { id: "p-producer", displayName: "Producer", role: "PRODUCER" }
      ]
    });

    expect(merge.segmentCount).toBeGreaterThan(2);
    expect(merge.segments[0]?.participantId).toBeTruthy();
    expect(merge.participantCoverage.length).toBe(3);
    expect(merge.deterministicMergeId).toContain("studio-merge-");
  });
});
