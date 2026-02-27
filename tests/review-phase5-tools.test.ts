import { describe, expect, it } from "vitest";
import {
  buildApprovalChainState,
  buildProjectShareUrl,
  buildReviewerPageUrl,
  evaluateApprovalGate,
  hasShareScope,
  normalizeApprovalChain,
  normalizeBrandPresetInput,
  normalizeBrandStudioMetadata,
  normalizeCommentAnchor
} from "@/lib/review-phase5-tools";

describe("review phase5 tools", () => {
  it("enforces share scope hierarchy", () => {
    expect(hasShareScope("APPROVE", "VIEW")).toBe(true);
    expect(hasShareScope("COMMENT", "COMMENT")).toBe(true);
    expect(hasShareScope("VIEW", "APPROVE")).toBe(false);
  });

  it("normalizes anchor windows and clamps order", () => {
    expect(
      normalizeCommentAnchor({
        anchorMs: 123.9,
        transcriptStartMs: 900,
        transcriptEndMs: 100
      })
    ).toEqual({
      anchorMs: 123,
      transcriptStartMs: 100,
      transcriptEndMs: 900
    });
  });

  it("evaluates approval gate requirements", () => {
    expect(
      evaluateApprovalGate({
        approvalRequired: false,
        currentRevisionId: "rev_a",
        latestDecision: null
      }).allowed
    ).toBe(true);

    expect(
      evaluateApprovalGate({
        approvalRequired: true,
        currentRevisionId: "rev_a",
        latestDecision: {
          status: "APPROVED",
          revisionId: "rev_b"
        }
      }).allowed
    ).toBe(false);
  });

  it("builds deterministic share url", () => {
    expect(buildProjectShareUrl("https://app.example.com/", "pv2_1", "tok_1"))
      .toBe("https://app.example.com/opencut/projects-v2/pv2_1?shareToken=tok_1");
    expect(buildReviewerPageUrl("https://app.example.com/", "pv2_1", "tok_1"))
      .toBe("https://app.example.com/opencut/projects-v2/pv2_1?shareToken=tok_1&reviewerPage=1");
  });

  it("normalizes brand preset defaults and deduplicates tags", () => {
    const normalized = normalizeBrandPresetInput({
      name: "  Creator Brand Kit  ",
      defaultConnector: "unknown",
      defaultVisibility: "unlisted",
      defaultTags: ["SaaS", "saas", "growth", "x", "  hooks  "],
      defaultTitlePrefix: "  Launch  "
    });

    expect(normalized.name).toBe("Creator Brand Kit");
    expect(normalized.defaultConnector).toBe("package");
    expect(normalized.defaultVisibility).toBe("unlisted");
    expect(normalized.defaultTags).toEqual(["saas", "growth", "hooks"]);
    expect(normalized.defaultTitlePrefix).toBe("Launch");
  });

  it("normalizes brand studio metadata for fonts, layouts, templates, and distribution", () => {
    const normalized = normalizeBrandStudioMetadata({
      brandKit: {
        primaryColor: "#102030"
      },
      customFonts: [
        {
          id: "font_main",
          name: "Headline",
          family: "Headline Sans",
          format: "woff2"
        }
      ],
      layoutPacks: [
        {
          id: "layout_one",
          name: "Podcast Vertical",
          aspectRatio: "9:16",
          sceneLayoutIds: ["intro", "speaker"]
        }
      ],
      distributionPresets: [
        {
          id: "dist_yt",
          name: "YouTube",
          connector: "youtube",
          visibility: "unlisted"
        }
      ]
    });

    expect(normalized.brandKit.primaryColor).toBe("#102030");
    expect(normalized.customFonts[0]?.id).toBe("font_main");
    expect(normalized.layoutPacks[0]?.id).toBe("layout_one");
    expect(normalized.distributionPresets[0]?.id).toBe("dist_yt");
    expect(Array.isArray(normalized.templatePacks)).toBe(true);
    expect(Array.isArray(normalized.metadataPacks)).toBe(true);
  });

  it("computes approval chain state from decision metadata", () => {
    const chain = normalizeApprovalChain([
      { id: "admin_step", role: "ADMIN", required: true, order: 1 },
      { id: "owner_step", role: "OWNER", required: true, order: 2 }
    ]);
    const state = buildApprovalChainState({
      chain,
      decisions: [
        {
          status: "APPROVED",
          metadata: { approvalChainStepId: "admin_step" },
          decidedByUserId: "user_admin",
          createdAt: "2026-02-26T10:00:00.000Z"
        }
      ]
    });

    expect(state.completedRequiredCount).toBe(1);
    expect(state.totalRequiredCount).toBe(2);
    expect(state.isComplete).toBe(false);
    expect(state.nextRequiredStepId).toBe("owner_step");
  });
});
