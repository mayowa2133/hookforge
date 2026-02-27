import { describe, expect, it, vi } from "vitest";
import {
  appendPublishingDiffGroup,
  AutopilotMacroIdSchema,
  UnderlordCommandFamilySchema,
  UNDERLORD_COMMAND_CATALOG,
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

  it("exposes underlord command family and quality delta preview metadata", () => {
    const resolved = resolveAutopilotPrompt({
      prompt: "Generate chapter markers and transcript cleanup notes",
      plannerPack: "transcript"
    });

    expect(resolved.commandFamily).toBe("chaptering");
    expect(resolved.qualityDeltaPreview.estimatedScoreDelta).toBeGreaterThan(0);
    expect(resolved.qualityDeltaPreview.confidence).toBeGreaterThan(0.6);
  });

  it("supports expanded macro taxonomy for underlord command families", () => {
    expect(() => AutopilotMacroIdSchema.parse("transcript_cleanup")).not.toThrow();
    expect(() => AutopilotMacroIdSchema.parse("extract_highlights")).not.toThrow();
    expect(() => AutopilotMacroIdSchema.parse("remove_retakes_word_gaps")).not.toThrow();
  });

  it("resolves command-family plans without explicit prompt", () => {
    const resolved = resolveAutopilotPrompt({
      commandFamily: "metadata_generation"
    });

    expect(resolved.commandFamily).toBe("metadata_generation");
    expect(resolved.originalPrompt.length).toBeGreaterThan(10);
    expect(resolved.resolvedPrompt).toContain("[Planner Pack:");
  });

  it("exposes command family schema and catalog coverage", () => {
    expect(() => UnderlordCommandFamilySchema.parse("pacing")).not.toThrow();
    expect(UNDERLORD_COMMAND_CATALOG.length).toBeGreaterThanOrEqual(9);
    expect(UNDERLORD_COMMAND_CATALOG.every((entry) => entry.defaultPrompt.length > 0)).toBe(true);
  });

  it("validates replay schema requiring explicit confirmation", async () => {
    const { AutopilotPlanSchema, AutopilotReplaySchema } = await import("@/lib/autopilot");
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
    expect(() =>
      AutopilotPlanSchema.parse({
        commandFamily: "highlight_clips"
      })
    ).not.toThrow();
  });
});
