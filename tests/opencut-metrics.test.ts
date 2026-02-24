import { describe, expect, it } from "vitest";
import { normalizeOpenCutEventName, summarizeOpenCutMetrics } from "@/lib/opencut/metrics";

describe("opencut metrics utilities", () => {
  it("normalizes known event names and rejects unknown names", () => {
    expect(normalizeOpenCutEventName("editor_open")).toBe("editor_open");
    expect(normalizeOpenCutEventName("unknown_event")).toBeNull();
  });

  it("summarizes success and error rates per event", () => {
    const summary = summarizeOpenCutMetrics({
      windowHours: 24,
      events: [
        {
          event: "chat_edit_apply",
          outcome: "SUCCESS",
          createdAt: new Date()
        },
        {
          event: "chat_edit_apply",
          outcome: "ERROR",
          createdAt: new Date()
        },
        {
          event: "render_start",
          outcome: "INFO",
          createdAt: new Date()
        }
      ]
    });

    const chat = summary.metrics.find((entry) => entry.event === "chat_edit_apply");
    const renderStart = summary.metrics.find((entry) => entry.event === "render_start");
    expect(summary.totalEvents).toBe(3);
    expect(chat?.total).toBe(2);
    expect(chat?.successRate).toBe(0.5);
    expect(renderStart?.successRate).toBeNull();
  });
});
