import { describe, expect, it } from "vitest";
import {
  buildChatConfidenceRationale,
  buildRevisionGraph,
  resolveChatSafetyMode,
  selectTimelineOperationsFromDecisions
} from "@/lib/chat-v2-tools";
import type { TimelineOperation } from "@/lib/timeline-types";

describe("chat-v2 tools", () => {
  it("classifies safety mode using execution mode and confidence", () => {
    expect(resolveChatSafetyMode({ executionMode: "SUGGESTIONS_ONLY", averageConfidence: 0.95 })).toBe("SUGGESTIONS_ONLY");
    expect(resolveChatSafetyMode({ executionMode: "APPLIED", averageConfidence: 0.72 })).toBe("APPLY_WITH_CONFIRM");
    expect(resolveChatSafetyMode({ executionMode: "APPLIED", averageConfidence: 0.92 })).toBe("APPLIED");
  });

  it("builds confidence rationale from validation state", () => {
    const rationale = buildChatConfidenceRationale(
      {
        isValid: false,
        lowConfidence: true,
        averageConfidence: 0.61,
        validPlanRate: 74.25,
        reasons: ["Planner confidence too low (0.61 < 0.68)"]
      },
      "Planner confidence too low"
    );

    expect(rationale.lowConfidence).toBe(true);
    expect(rationale.reasons.length).toBe(1);
    expect(rationale.fallbackReason).toContain("too low");
  });

  it("selects timeline operations from per-item decisions", () => {
    const operations = [
      { op: "split_clip" },
      { op: "move_clip" },
      { op: "trim_clip" }
    ] as TimelineOperation[];

    const selected = selectTimelineOperationsFromDecisions({
      operations,
      timelineItems: [
        { id: "timeline-op-1", operationIndex: 0 },
        { id: "timeline-op-2", operationIndex: 1 },
        { id: "timeline-op-3", operationIndex: 2 }
      ],
      decisions: [
        { itemId: "timeline-op-1", accepted: true },
        { itemId: "timeline-op-2", accepted: false },
        { itemId: "timeline-op-3", accepted: true }
      ]
    });

    expect(selected.selectedOperations.map((entry) => entry.op)).toEqual(["split_clip", "trim_clip"]);
    expect(selected.selectedCount).toBe(2);
    expect(selected.skippedCount).toBe(1);
  });

  it("builds a linear revision graph with current marker", () => {
    const graph = buildRevisionGraph({
      revisions: [
        {
          id: "rev_1",
          revisionNumber: 1,
          operations: { source: "initial_create" },
          createdAt: new Date("2026-02-01T00:00:00.000Z")
        },
        {
          id: "rev_2",
          revisionNumber: 2,
          operations: { source: "chat_plan_apply_v2" },
          createdAt: new Date("2026-02-01T01:00:00.000Z")
        },
        {
          id: "rev_3",
          revisionNumber: 3,
          operations: { source: "chat_plan_undo_v2" },
          createdAt: new Date("2026-02-01T01:30:00.000Z")
        }
      ],
      currentRevisionId: "rev_3"
    });

    expect(graph.nodes.length).toBe(3);
    expect(graph.edges.length).toBe(2);
    expect(graph.nodes.at(-1)?.isCurrent).toBe(true);
    expect(graph.edges[1]?.reason).toBe("chat_plan_undo_v2");
  });
});
