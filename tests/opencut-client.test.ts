import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyProjectV2ChatEdit,
  autoTranscript,
  getProjectV2EditorState,
  getProjectV2Presets,
  getProjectV2,
  getOpenCutMetrics,
  importProjectV2Media,
  patchTimeline,
  patchTranscript,
  registerProjectV2Media,
  planProjectV2ChatEdit,
  applyProjectV2Preset,
  startRender,
  trackOpenCutTelemetry,
  undoProjectV2ChatEdit
} from "@/lib/opencut/hookforge-client";

function mockResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body
  } as Response;
}

describe("opencut hookforge client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls projects-v2 endpoint for project fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        project: {
          id: "pv2_1",
          title: "Project",
          status: "DRAFT",
          legacyProjectId: "legacy_1",
          entrypointPath: "/opencut/projects-v2/pv2_1"
        }
      })
    );

    const payload = await getProjectV2("pv2_1");
    expect(payload.project.id).toBe("pv2_1");
    expect(fetchSpy).toHaveBeenCalledWith("/api/projects-v2/pv2_1", undefined);
  });

  it("posts transcript auto payload to projects-v2 alias route", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({ aiJobId: "job_1", status: "QUEUED", trackId: "track_1" }, true, 202)
    );

    await autoTranscript("pv2_2", {
      language: "en",
      diarization: false,
      punctuationStyle: "auto",
      confidenceThreshold: 0.86,
      reDecodeEnabled: true,
      maxWordsPerSegment: 7,
      maxCharsPerLine: 24,
      maxLinesPerSegment: 2
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects-v2/pv2_2/transcript/auto",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("throws with API error payload when request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse({ error: "Bad request" }, false, 400));

    await expect(
      patchTranscript("pv2_2", {
        language: "en",
        operations: [{ op: "normalize_punctuation" }]
      })
    ).rejects.toThrow("Bad request");
  });

  it("starts render through projects-v2 final render endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        renderJob: {
          id: "render_1",
          status: "QUEUED",
          progress: 0
        }
      })
    );

    const payload = await startRender("pv2_3");
    expect(payload.renderJob.id).toBe("render_1");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects-v2/pv2_3/render/final",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("posts timeline operations through projects-v2 timeline endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        timeline: {
          tracks: []
        },
        revisionId: "rev_1",
        revision: 2
      })
    );

    await patchTimeline("pv2_4", [
      {
        op: "move_clip",
        trackId: "track_1",
        clipId: "clip_1",
        timelineInMs: 600
      }
    ]);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects-v2/pv2_4/timeline",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("imports media through projects-v2 media import endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        uploadUrl: "https://storage.local/upload",
        storageKey: "projects/pv2_5/file.mp4",
        method: "PUT",
        headers: {
          "Content-Type": "video/mp4"
        },
        assetIdDraft: "pv2_5:projects/pv2_5/file.mp4"
      })
    );

    const payload = await importProjectV2Media("pv2_5", {
      fileName: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 10123
    });

    expect(payload.storageKey).toContain("projects");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects-v2/pv2_5/media/import",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("registers uploaded media through projects-v2 media register endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        asset: {
          id: "asset_1",
          slotKey: "main",
          kind: "VIDEO",
          signedUrl: "https://storage.local/asset.mp4",
          durationSec: 4.2,
          mimeType: "video/mp4"
        },
        project: {
          id: "proj_1",
          status: "READY"
        },
        mediaAsset: {
          id: "ma_1",
          storageKey: "projects/pv2_6/clip.mp4",
          kind: "VIDEO",
          mimeType: "video/mp4",
          durationSec: 4.2
        },
        missingSlotKeys: []
      })
    );

    const payload = await registerProjectV2Media("pv2_6", {
      storageKey: "projects/pv2_6/clip.mp4",
      mimeType: "video/mp4"
    });
    expect(payload.project.status).toBe("READY");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects-v2/pv2_6/media/register",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("creates chat plan through projects-v2 chat plan endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        planId: "plan_1",
        confidence: 0.78,
        requiresConfirmation: true,
        executionMode: "SUGGESTIONS_ONLY",
        opsPreview: [],
        constrainedSuggestions: ["Try: split clip 1 at 500ms"],
        issues: []
      })
    );

    const payload = await planProjectV2ChatEdit("pv2_7", {
      prompt: "tighten this section and remove dead air"
    });
    expect(payload.planId).toBe("plan_1");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects-v2/pv2_7/chat/plan",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("applies planned chat edit through projects-v2 chat apply endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        applied: true,
        suggestionsOnly: false,
        issues: [],
        revisionId: "rev_1",
        undoToken: "undo_1"
      })
    );

    const payload = await applyProjectV2ChatEdit("pv2_8", {
      planId: "plan_1",
      confirmed: true
    });
    expect(payload.applied).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects-v2/pv2_8/chat/apply",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("runs chat undo through projects-v2 chat undo endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        restored: true,
        appliedRevisionId: "rev_undo_1"
      })
    );

    const payload = await undoProjectV2ChatEdit("pv2_8", { undoToken: "token_12345678" });
    expect(payload.restored).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects-v2/pv2_8/chat/undo",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("fetches editor state and presets and applies preset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          project: {
            id: "pv2_9",
            title: "Project",
            status: "DRAFT",
            creationMode: "FREEFORM",
            hasLegacyBridge: true,
            legacyProjectId: "legacy_9"
          },
          assets: [],
          mediaAssets: [],
          timeline: {
            timeline: { tracks: [] },
            revisionId: null,
            revision: 1
          },
          transcript: null
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          presets: [
            { id: "green-screen-commentator", slug: "green-screen-commentator", name: "Green Screen", description: "", tags: [] }
          ]
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          applied: true,
          presetId: "green-screen-commentator",
          revisionId: "rev_12",
          operationCount: 2
        })
      );

    const editorState = await getProjectV2EditorState("pv2_9");
    const presets = await getProjectV2Presets();
    const applyResult = await applyProjectV2Preset("pv2_9", "green-screen-commentator");

    expect(editorState.project.id).toBe("pv2_9");
    expect(presets.presets.length).toBe(1);
    expect(applyResult.applied).toBe(true);
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/api/projects-v2/pv2_9/editor-state", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/projects-v2/presets", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/projects-v2/pv2_9/presets/apply",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("tracks opencut telemetry events", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        tracked: true,
        eventId: "evt_1",
        createdAt: new Date().toISOString()
      })
    );

    await trackOpenCutTelemetry({
      projectId: "pv2_9",
      event: "render_start",
      outcome: "INFO",
      metadata: { source: "test" }
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/opencut/telemetry",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("fetches opencut metrics snapshot", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        windowHours: 24,
        totalEvents: 2,
        generatedAt: new Date().toISOString(),
        metrics: []
      })
    );

    const payload = await getOpenCutMetrics(24);
    expect(payload.windowHours).toBe(24);
    expect(fetchSpy).toHaveBeenCalledWith("/api/opencut/metrics?windowHours=24", undefined);
  });
});
