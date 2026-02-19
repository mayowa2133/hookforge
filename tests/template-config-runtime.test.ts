import { describe, expect, it } from "vitest";
import { templateCatalog } from "../lib/template-catalog";
import { validateAndMergeConfig } from "../lib/template-runtime";

describe("template config runtime", () => {
  const template = templateCatalog.find((entry) => entry.slug === "tweet-comment-popup-reply");
  if (!template) {
    throw new Error("Missing tweet-comment-popup-reply template");
  }

  it("ignores non-control metadata keys in config", () => {
    const config = validateAndMergeConfig(template as { slotSchema: unknown }, {
      chatEditUndoStack: [{ token: "undo_1" }],
      overlayAppearSec: 2.5
    });

    expect(config.overlayAppearSec).toBe(2.5);
    expect("chatEditUndoStack" in config).toBe(false);
  });

  it("keeps defaults when override types are invalid", () => {
    const config = validateAndMergeConfig(template as { slotSchema: unknown }, {
      overlayAppearSec: "2.5",
      animation: 7,
      notificationSfx: "true"
    });

    expect(config.overlayAppearSec).toBe(1);
    expect(config.animation).toBe("pop");
    expect(config.notificationSfx).toBe(false);
  });
});
