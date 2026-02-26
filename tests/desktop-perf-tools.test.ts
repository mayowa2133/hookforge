import { describe, expect, it } from "vitest";
import { buildProjectPerfHints } from "@/lib/desktop/perf";
import { extractDurationMs, normalizeDesktopEventName } from "@/lib/desktop/events";

describe("desktop perf helpers", () => {
  it("normalizes desktop events and extracts durations", () => {
    expect(normalizeDesktopEventName("editor_boot")).toBe("editor_boot");
    expect(normalizeDesktopEventName("unknown")).toBeNull();
    expect(extractDurationMs({ durationMs: 87.5 })).toBe(88);
    expect(extractDurationMs({ durationMs: "87" })).toBeNull();
  });

  it("builds performance hints and budget warnings", () => {
    const hints = buildProjectPerfHints({
      trackCount: 5,
      clipCount: 260,
      segmentCount: 300,
      wordCount: 9000,
      hasRenderableMedia: true,
      editorOpenDurationsMs: [1200, 1800, 2400, 3100],
      commandDurationsMs: [40, 50, 120, 140]
    });

    expect(hints.suggested.enableLaneCollapse).toBe(true);
    expect(hints.suggested.segmentWindowSize).toBeLessThanOrEqual(160);
    expect(hints.hints.some((hint) => hint.id === "open_latency_budget")).toBe(true);
    expect(hints.hints.some((hint) => hint.id === "command_latency_budget")).toBe(true);
  });
});
