import { describe, expect, it, vi } from "vitest";
import {
  appendPublishingDiffGroup,
  getTimelineOperationItemIds,
  resolveAutopilotPrompt
} from "@/lib/autopilot-tools";

vi.mock("server-only", () => ({}));

describe("autopilot tools", () => {
  it("resolves macro prompts with deterministic planner-pack instructions", () => {
    const resolved = resolveAutopilotPrompt({
      macroId: "social_cut_from_range",
      macroArgs: {
        startMs: 1200,
        endMs: 9500
      }
    });

    expect(resolved.macroId).toBe("social_cut_from_range");
    expect(resolved.plannerPack).toBe("timeline");
    expect(resolved.resolvedPrompt).toContain("[Planner Pack: timeline]");
    expect(resolved.resolvedPrompt).toContain("1200-9500ms");
  });

  it("appends publishing diff group only for publishing planner pack", () => {
    const base = [
      {
        group: "timeline" as const,
        title: "Timeline Changes",
        summary: "1 op",
        items: [{ id: "timeline-op-1", type: "operation" as const, label: "1. Split Clip", operationIndex: 0 }]
      }
    ];

    const withPublishing = appendPublishingDiffGroup({
      groups: base,
      plannerPack: "publishing",
      constrainedSuggestions: [
        {
          title: "Add CTA",
          prompt: "Add closing CTA before outro",
          reason: "Improve conversion"
        }
      ]
    });

    const nonPublishing = appendPublishingDiffGroup({
      groups: base,
      plannerPack: "timeline",
      constrainedSuggestions: [
        {
          title: "Add CTA",
          prompt: "Add closing CTA before outro",
          reason: "Improve conversion"
        }
      ]
    });

    expect(withPublishing.some((group) => group.group === "publishing")).toBe(true);
    expect(nonPublishing.some((group) => group.group === "publishing")).toBe(false);
  });

  it("extracts timeline operation item ids for confirm-required apply mode", () => {
    const ids = getTimelineOperationItemIds([
      {
        group: "timeline",
        title: "Timeline Changes",
        summary: "2 ops",
        items: [
          { id: "timeline-op-1", type: "operation", label: "Split", operationIndex: 0 },
          { id: "timeline-note-1", type: "note", label: "Note" },
          { id: "timeline-op-2", type: "operation", label: "Trim", operationIndex: 1 }
        ]
      },
      {
        group: "audio",
        title: "Audio",
        summary: "0 ops",
        items: []
      }
    ]);

    expect(ids).toEqual(["timeline-op-1", "timeline-op-2"]);
  });

  it("validates replay schema requiring explicit confirmation", async () => {
    const { AutopilotReplaySchema } = await import("@/lib/autopilot");
    expect(() =>
      AutopilotReplaySchema.parse({
        sessionId: "sess_1",
        confirmed: true,
        applyImmediately: true
      })
    ).not.toThrow();
    expect(() =>
      AutopilotReplaySchema.parse({
        sessionId: "sess_1",
        confirmed: false
      })
    ).toThrow();
  });
});
