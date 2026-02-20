import { describe, expect, it } from "vitest";
import {
  buildDeliverableLines,
  buildKpiRows,
  buildRiskRows,
  buildTrackStatusRows,
  extractAppendix,
  parseProgressDoc,
  type QualityProgressDoc
} from "../scripts/update-captions-quality-progress";

describe("captions quality progress script helpers", () => {
  const sample: QualityProgressDoc = {
    program: "Program",
    owner: "Owner",
    lastUpdated: "2026-02-20T00:00:00.000Z",
    tracks: [
      {
        id: "track_a",
        title: "Track A",
        status: "IN_PROGRESS",
        kpis: [{ name: "kpi", current: "1", target: "2", unit: "%" }],
        deliverables: [{ id: "a1", title: "deliverable", status: "DONE", evidencePath: "a.md" }],
        risks: [{ id: "r1", severity: "HIGH", mitigation: "mitigate" }]
      }
    ]
  };

  it("parses valid json payload", () => {
    const parsed = parseProgressDoc(JSON.stringify(sample));
    expect(parsed.program).toBe("Program");
    expect(parsed.tracks.length).toBe(1);
  });

  it("builds markdown row sections", () => {
    expect(buildTrackStatusRows(sample.tracks)).toContain("track_a");
    expect(buildKpiRows(sample.tracks)).toContain("kpi");
    expect(buildDeliverableLines(sample.tracks)).toContain("a1");
    expect(buildRiskRows(sample.tracks)).toContain("r1");
  });

  it("preserves static appendix when markers exist", () => {
    const existing = [
      "before",
      "<!-- STATIC_APPENDIX_START -->",
      "custom appendix",
      "<!-- STATIC_APPENDIX_END -->",
      "after"
    ].join("\n");

    const appendix = extractAppendix(existing);
    expect(appendix).toContain("custom appendix");
    expect(appendix).toContain("STATIC_APPENDIX_START");
    expect(appendix).toContain("STATIC_APPENDIX_END");
  });
});
