import { describe, expect, it } from "vitest";
import { buildChatEditPlan } from "../lib/ai/chat-edit";

describe("buildChatEditPlan", () => {
  it("detects multiple edit intents from prompt", () => {
    const plan = buildChatEditPlan("Please split the intro, trim pauses, and update captions");

    const ops = plan.map((entry) => entry.op);
    expect(ops).toContain("split");
    expect(ops).toContain("trim");
    expect(ops).toContain("caption_style");
  });

  it("falls back to generic operation when no known intent exists", () => {
    const plan = buildChatEditPlan("do something magical");
    expect(plan).toHaveLength(1);
    expect(plan[0].op).toBe("generic");
  });
});
