import { describe, expect, it } from "vitest";
import {
  applyMobileTelemetryEvent,
  emptyMobileGlobalCounters,
  emptyMobileWorkflowCounters,
  mobileWorkflowCatalog,
  summarizeMobileTelemetry,
  type MobileWorkflowId
} from "@/lib/mobile/telemetry";
import { buildResumableProgress } from "@/lib/mobile/resumable";

function emptyWorkflowMap() {
  return Object.fromEntries(
    mobileWorkflowCatalog.map((workflow) => [workflow.id, emptyMobileWorkflowCounters()])
  ) as Record<MobileWorkflowId, ReturnType<typeof emptyMobileWorkflowCounters>>;
}

describe("track f mobile workflow tools", () => {
  it("builds resumable upload progress details", () => {
    const progress = buildResumableProgress(4, [3, 1, 3]);

    expect(progress.completedParts).toBe(2);
    expect(progress.remainingParts).toBe(2);
    expect(progress.uploadedPartNumbers).toEqual([1, 3]);
    expect(progress.missingPartNumbers).toEqual([2, 4]);
    expect(progress.progressPct).toBe(50);
  });

  it("aggregates telemetry events and computes health summary", () => {
    let global = emptyMobileGlobalCounters();
    let workflows = emptyWorkflowMap();

    const events = [
      { sessionId: "s1", platform: "ios" as const, event: "SESSION_START" as const },
      { sessionId: "s2", platform: "android" as const, event: "SESSION_START" as const },
      { sessionId: "s1", platform: "ios" as const, event: "WORKFLOW_START" as const, workflowId: "creator_to_render" as const },
      {
        sessionId: "s1",
        platform: "ios" as const,
        event: "WORKFLOW_COMPLETE" as const,
        workflowId: "creator_to_render" as const,
        latencyMs: 1800
      },
      { sessionId: "s2", platform: "android" as const, event: "SESSION_CRASH" as const },
      { sessionId: "s1", platform: "ios" as const, event: "SESSION_END" as const }
    ];

    for (const event of events) {
      const next = applyMobileTelemetryEvent(global, workflows, event);
      global = next.global;
      workflows = next.workflows;
    }

    const summary = summarizeMobileTelemetry({ global, workflows });
    expect(summary.crashFreeSessionsPct).toBe(50);
    expect(summary.meetsCrashFreeTarget).toBe(false);
    expect(summary.workflowSummaries.find((workflow) => workflow.id === "creator_to_render")?.mobileCompletionRatePct).toBe(
      100
    );
    expect(summary.topWorkflowGapPct).toBeGreaterThanOrEqual(0);
  });

  it("treats empty telemetry as healthy defaults", () => {
    const summary = summarizeMobileTelemetry({
      global: emptyMobileGlobalCounters(),
      workflows: emptyWorkflowMap()
    });

    expect(summary.crashFreeSessionsPct).toBe(100);
    expect(summary.topWorkflowGapPct).toBe(0);
    expect(summary.meetsCrashFreeTarget).toBe(true);
    expect(summary.meetsWorkflowGapTarget).toBe(true);
  });
});
