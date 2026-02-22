import { describe, expect, it } from "vitest";
import { groundAdClaims, rankAdCandidates, rankShortsCandidates } from "@/lib/ai/phase4-quality";

describe("phase4 quality helpers", () => {
  it("flags unsupported superlative claims", () => {
    const grounding = groundAdClaims({
      script: {
        hook: "This is the best tool for creators.",
        proof: "It guarantees overnight growth.",
        cta: "Try it now.",
        lines: ["This is the best tool for creators.", "It guarantees overnight growth.", "Try it now."]
      },
      sourceFacts: ["example.com", "HookForge"]
    });

    expect(grounding.passed).toBe(false);
    expect(grounding.flaggedClaims.length).toBeGreaterThan(0);
  });

  it("ranks ad candidates and prefers grounded variants", () => {
    const ranked = rankAdCandidates({
      durationSec: 30,
      sourceFacts: ["example.com", "HookForge"],
      candidates: [
        {
          id: "unsafe",
          tone: "hype",
          script: {
            hook: "The best marketing tool ever.",
            proof: "Guaranteed overnight conversions.",
            cta: "Buy now.",
            lines: ["The best marketing tool ever.", "Guaranteed overnight conversions.", "Buy now."]
          }
        },
        {
          id: "safe",
          tone: "ugc",
          script: {
            hook: "I tested HookForge to speed up edits.",
            proof: "It keeps hook, structure, and exports in one workflow.",
            cta: "Comment HOOK for setup.",
            lines: [
              "I tested HookForge to speed up edits.",
              "It keeps hook, structure, and exports in one workflow.",
              "Comment HOOK for setup."
            ]
          }
        }
      ]
    });

    expect(ranked.selected.id).toBe("safe");
    expect(ranked.qualitySummary.candidateUpliftPct).toBeGreaterThan(0);
  });

  it("suppresses duplicate shorts clips and keeps requested count", () => {
    const ranked = rankShortsCandidates({
      clipCount: 2,
      durationSec: 200,
      candidates: [
        { id: "a", startSec: 10, endSec: 35, title: "Hook 1", reason: "Strong hook and proof" },
        { id: "b", startSec: 12, endSec: 36, title: "Hook 1", reason: "Strong hook and proof" },
        { id: "c", startSec: 80, endSec: 108, title: "Hook 2", reason: "Clear point and CTA" },
        { id: "d", startSec: 120, endSec: 146, title: "Hook 3", reason: "High engagement moment" }
      ]
    });

    expect(ranked.selected.length).toBe(2);
    expect(ranked.duplicatesSuppressed).toBeGreaterThan(0);
    expect(ranked.qualitySummary.candidateUpliftPct).toBeGreaterThanOrEqual(0);
  });
});
