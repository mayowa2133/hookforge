import { describe, expect, it } from "vitest";
import { queueNames } from "../lib/queue-names";

describe("queue topology", () => {
  it("contains all parity phase-0 queue names", () => {
    expect(queueNames).toMatchObject({
      ingest: "ingest",
      transcribe: "transcribe",
      captionStyle: "caption-style",
      translate: "translate",
      dubLipSync: "dub-lipsync",
      aiEdit: "ai-edit",
      aiGenerate: "ai-generate",
      renderPreview: "render-preview",
      renderFinal: "render-final",
      notify: "notify",
      billingMeter: "billing-meter"
    });
  });

  it("keeps legacy render queue for backward compatibility", () => {
    expect(queueNames.renderProject).toBe("render-project");
  });
});
