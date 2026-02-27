import { describe, expect, it } from "vitest";
import {
  buildDesktopDropIngestPlan,
  buildDesktopNotificationQueue,
  mergeDesktopOfflineDrafts,
  recommendDesktopMediaRelink
} from "@/lib/desktop/workflows";

describe("desktop phase5 workflows", () => {
  it("builds drag-drop ingest plans with accepted and rejected files", () => {
    const plan = buildDesktopDropIngestPlan({
      maxUploadMb: 10,
      files: [
        { fileName: "episode.mov", mimeType: "video/quicktime", sizeBytes: 1_000_000 },
        { fileName: "too-big.mov", mimeType: "video/mp4", sizeBytes: 20 * 1024 * 1024 },
        { fileName: "notes.txt", mimeType: "text/plain", sizeBytes: 1000 }
      ]
    });

    expect(plan.summary.total).toBe(3);
    expect(plan.summary.accepted).toBe(1);
    expect(plan.summary.rejected).toBe(2);
    expect(plan.accepted[0]?.slot).toBe("primary");
  });

  it("tracks offline draft conflicts when revision drifts", () => {
    const merged = mergeDesktopOfflineDrafts({
      existingDrafts: [],
      currentRevisionId: "rev_2",
      mutation: {
        draftId: "draft_1",
        clientId: "desktop_1",
        basedOnRevisionId: "rev_1",
        operations: [{ op: "split_clip" }]
      }
    });

    expect(merged.summary.conflict).toBe(1);
    expect(merged.drafts[0]?.status).toBe("CONFLICT");
  });

  it("recommends high-confidence media relink candidates", () => {
    const recs = recommendDesktopMediaRelink({
      missingAssets: [{ assetId: "asset_1", originalFileName: "Interview-CamA.mov", expectedDurationSec: 301 }],
      candidates: [
        { fileName: "Interview-CamA.mov", absolutePath: "/Volumes/media/Interview-CamA.mov", durationSec: 301.2, sizeBytes: 1000 },
        { fileName: "Broll.mov", absolutePath: "/Volumes/media/Broll.mov", durationSec: 20, sizeBytes: 200 }
      ]
    });

    expect(recs.summary.matched).toBe(1);
    expect(recs.recommendations[0]?.selectedCandidate?.confidence).toBe("HIGH");
  });

  it("builds desktop notifications from crash events and unresolved relink", () => {
    const notifications = buildDesktopNotificationQueue({
      recentEvents: [
        {
          id: "evt_1",
          event: "desktop.native_crash",
          outcome: "ERROR",
          createdAt: new Date().toISOString(),
          metadata: { sessionId: "sess_1" }
        }
      ],
      relinkSummary: { unmatched: 2 },
      offlineDraftSummary: { conflict: 1 }
    });

    expect(notifications.some((item) => item.kind === "SYSTEM")).toBe(true);
    expect(notifications.some((item) => item.kind === "RELINK")).toBe(true);
    expect(notifications.some((item) => item.kind === "OFFLINE_DRAFT")).toBe(true);
  });
});
