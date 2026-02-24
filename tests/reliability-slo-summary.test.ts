import { describe, expect, it } from "vitest";
import { summarizeSloMetrics } from "@/lib/ops";

const now = new Date("2026-02-24T00:00:00.000Z");

describe("reliability slo summary", () => {
  it("computes success rates and p95 latencies", () => {
    const summary = summarizeSloMetrics({
      renderRows: [
        { status: "DONE", createdAt: now, updatedAt: new Date(now.getTime() + 3_000) },
        { status: "DONE", createdAt: now, updatedAt: new Date(now.getTime() + 5_000) },
        { status: "ERROR", createdAt: now, updatedAt: new Date(now.getTime() + 8_000) }
      ],
      aiRows: [
        { status: "DONE", createdAt: now, updatedAt: new Date(now.getTime() + 1_000) },
        { status: "DONE", createdAt: now, updatedAt: new Date(now.getTime() + 2_000) },
        { status: "DONE", createdAt: now, updatedAt: new Date(now.getTime() + 2_500) },
        { status: "ERROR", createdAt: now, updatedAt: new Date(now.getTime() + 4_000) }
      ]
    });

    expect(summary.render.total).toBe(3);
    expect(summary.render.successRatePct).toBeCloseTo(66.67, 2);
    expect(summary.render.p95LatencyMs).toBe(8_000);
    expect(summary.ai.total).toBe(4);
    expect(summary.ai.successRatePct).toBe(75);
    expect(summary.ai.p95LatencyMs).toBe(4_000);
  });
});
