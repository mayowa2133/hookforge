import { describe, expect, it } from "vitest";
import {
  buildDeterministicAdScript,
  buildDeterministicShortlist,
  buildRankedAdPlan,
  buildRankedShortlistPlan,
  estimatePhase4AdsCredits,
  estimatePhase4ShortsCredits,
  extractRedditContext
} from "@/lib/ai/phase4";
import { detectSourceTypeFromUrl } from "@/lib/compliance";

describe("phase4 growth/compliance tools", () => {
  it("builds deterministic ad script blocks", () => {
    const script = buildDeterministicAdScript({
      websiteUrl: "https://example.com/product",
      productName: "HookForge",
      tone: "ugc"
    });

    expect(script.product).toBe("HookForge");
    expect(script.domain).toBe("example.com");
    expect(script.lines.length).toBe(3);
    expect(script.hook.length).toBeGreaterThan(10);
  });

  it("builds deterministic shorts shortlist with bounded clip count", () => {
    const shortlist = buildDeterministicShortlist({
      sourceUrl: "https://www.youtube.com/watch?v=test",
      sourceType: "YOUTUBE",
      clipCount: 9,
      language: "en",
      durationSec: 240
    });

    expect(shortlist.clips.length).toBe(5);
    expect(shortlist.confidence).toBeGreaterThan(0.7);
    expect(shortlist.clips[0].endSec).toBeGreaterThan(shortlist.clips[0].startSec);
  });

  it("extracts reddit context from URL path", () => {
    const context = extractRedditContext({
      redditUrl: "https://www.reddit.com/r/startups/comments/abc123/how_to_launch/"
    });

    expect(context.subreddit).toBe("startups");
    expect(context.title.toLowerCase()).toContain("launch");
    expect(context.prompt.toLowerCase()).toContain("startups");
  });

  it("detects source type from URL host", () => {
    expect(detectSourceTypeFromUrl("https://www.youtube.com/watch?v=123")).toBe("YOUTUBE");
    expect(detectSourceTypeFromUrl("https://www.reddit.com/r/test/comments/abc/post")).toBe("REDDIT");
    expect(detectSourceTypeFromUrl("https://example.com/blog")).toBe("WEBSITE");
  });

  it("estimates phase4 credits", () => {
    const adCredits = estimatePhase4AdsCredits({ durationSec: 35, hasVoice: true });
    const shortsCredits = estimatePhase4ShortsCredits({ clipCount: 3, sourceType: "YOUTUBE" });

    expect(adCredits).toBeGreaterThan(100);
    expect(shortsCredits).toBeGreaterThan(150);
  });

  it("ranks ad candidates and returns claim grounding metadata", () => {
    const ranked = buildRankedAdPlan({
      websiteUrl: "https://example.com/pricing",
      productName: "HookForge",
      tone: "ugc",
      durationSec: 30
    });

    expect(ranked.rankedCandidates.length).toBeGreaterThan(1);
    expect(ranked.qualitySummary.ratingScore).toBeGreaterThanOrEqual(4.2);
    expect(ranked.qualitySummary.candidateUpliftPct).toBeGreaterThan(0);
    expect(typeof ranked.selectedCandidate.grounding.passed).toBe("boolean");
  });

  it("ranks shorts candidates and suppresses duplicates", () => {
    const ranked = buildRankedShortlistPlan({
      sourceUrl: "https://www.youtube.com/watch?v=test",
      sourceType: "YOUTUBE",
      clipCount: 3,
      language: "en",
      durationSec: 260
    });

    expect(ranked.shortlistClips.length).toBe(3);
    expect(ranked.rankedCandidates.length).toBeGreaterThan(3);
    expect(ranked.qualitySummary.ratingScore).toBeGreaterThanOrEqual(4.2);
    expect(ranked.qualitySummary.candidateUpliftPct).toBeGreaterThan(0);
    expect(ranked.duplicatesSuppressed).toBeGreaterThanOrEqual(0);
  });
});
