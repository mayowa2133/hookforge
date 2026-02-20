import { describe, expect, it } from "vitest";
import { normalizeRoutingCapability } from "@/lib/models/route-policy";

describe("quality routing helpers", () => {
  it("normalizes known capabilities", () => {
    expect(normalizeRoutingCapability("ASR")).toBe("asr");
    expect(normalizeRoutingCapability("chat-edit")).toBe("chat_edit");
    expect(normalizeRoutingCapability("public translate")).toBe("public_translate");
  });

  it("falls back to general for unknown capability", () => {
    expect(normalizeRoutingCapability("unknown-thing")).toBe("general");
  });
});
