import { describe, expect, it } from "vitest";
import {
  buildProjectShareUrl,
  evaluateApprovalGate,
  hasShareScope,
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
  });
});
