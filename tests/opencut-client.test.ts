import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTranscriptOps,
  applyProjectV2ChatEdit,
  autoTranscript,
  getProjectV2EditorHealth,
  getProjectV2EditorState,
  getProjectV2Presets,
  getProjectV2,
  getOpenCutMetrics,
  importProjectV2Media,
  patchTimeline,
  patchTranscript,
  previewTranscriptOps,
  registerProjectV2Media,
  searchTranscript,
  planProjectV2ChatEdit,
  applyProjectV2Preset,
  cancelProjectV2RecordingSession,
  finalizeProjectV2RecordingSession,
  startRender,
  startProjectV2RecordingSession,
  trackOpenCutTelemetry,
  undoProjectV2ChatEdit,
  postProjectV2RecordingChunk,
  getProjectV2RecordingSession
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
        method: "PATCH"
      })
    );
  });

  it("searches transcript and supports preview/apply transcript ops routes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_1",
          projectV2Id: "pv2_4",
          language: "en",
          query: "hook",
          totalSegments: 4,
          totalMatches: 1,
          matches: [
            {
              segmentId: "seg_1",
              startMs: 0,
              endMs: 1000,
              text: "great hook here",
              confidenceAvg: 0.88,
              matchStart: 6,
              matchEnd: 10
            }
          ],
          tookMs: 2
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          mode: "PREVIEW",
          applied: false,
          suggestionsOnly: false,
          revisionId: null,
          issues: [],
          timelineOps: [{ op: "trim_clip" }]
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          mode: "APPLY",
          applied: true,
          suggestionsOnly: false,
          revisionId: "rev_1",
          issues: [],
          timelineOps: [{ op: "trim_clip" }]
        })
      );

    const search = await searchTranscript("pv2_4", "en", "hook");
    const preview = await previewTranscriptOps("pv2_4", {
      language: "en",
      operations: [{ op: "normalize_punctuation" }]
    });
    const apply = await applyTranscriptOps("pv2_4", {
      language: "en",
      operations: [{ op: "normalize_punctuation" }]
    });

    expect(search.totalMatches).toBe(1);
    expect(preview.mode).toBe("PREVIEW");
    expect(apply.mode).toBe("APPLY");
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/api/projects-v2/pv2_4/transcript/search?language=en&q=hook", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/projects-v2/pv2_4/transcript/ops/preview",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/projects-v2/pv2_4/transcript/ops/apply",
      expect.objectContaining({ method: "POST" })
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

  it("supports recording session lifecycle APIs for projects-v2", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          session: {
            id: "rec_1",
            projectId: "pv2_7",
            mode: "SCREEN_CAMERA",
            language: "en",
            autoTranscribe: true,
            storageKey: "projects/pv2_7/recording.webm",
            totalParts: 2,
            partSizeBytes: 8388608,
            minPartSizeBytes: 5242880,
            recommendedPartSizeBytes: 8388608,
            status: "ACTIVE"
          },
          next: {
            chunkEndpoint: "/api/projects-v2/pv2_7/recordings/session/rec_1/chunk",
            statusEndpoint: "/api/projects-v2/pv2_7/recordings/session/rec_1",
            finalizeEndpoint: "/api/projects-v2/pv2_7/recordings/session/rec_1/finalize",
            cancelEndpoint: "/api/projects-v2/pv2_7/recordings/session/rec_1/cancel"
          }
        })
      )
      .mockResolvedValueOnce(mockResponse({ mode: "UPLOAD_URL", partNumber: 1, uploadUrl: "https://upload.local", method: "PUT" }))
      .mockResolvedValueOnce(
        mockResponse({
          session: {
            id: "rec_1",
            mode: "SCREEN_CAMERA",
            status: "ACTIVE",
            fileName: "recording.webm",
            mimeType: "video/webm",
            sizeBytes: 12000,
            totalParts: 2,
            partSizeBytes: 8388608,
            autoTranscribe: true,
            language: "en",
            finalizedAssetId: null,
            finalizeAiJobId: null,
            failedReason: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null
          },
          progress: {
            totalParts: 2,
            completedParts: 1,
            remainingParts: 1,
            missingPartNumbers: [2],
            uploadedPartNumbers: [1],
            progressPct: 50
          },
          chunks: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          finalized: true,
          status: "COMPLETED",
          recordingSessionId: "rec_1",
          finalizedAssetId: "ma_1",
          aiJobId: "ai_1",
          media: {
            asset: {
              id: "a_1",
              slotKey: "freeform-video-1",
              kind: "VIDEO",
              signedUrl: "https://cdn.local/a.mp4",
              durationSec: 4.2,
              mimeType: "video/mp4"
            },
            mediaAsset: {
              id: "ma_1",
              storageKey: "projects/pv2_7/recording.webm",
              kind: "VIDEO",
              mimeType: "video/mp4",
              durationSec: 4.2
            },
            project: {
              id: "pv2_7",
              status: "READY"
            },
            missingSlotKeys: []
          }
        })
      )
      .mockResolvedValueOnce(mockResponse({ canceled: true, status: "CANCELED" }));

    const started = await startProjectV2RecordingSession("pv2_7", {
      mode: "SCREEN_CAMERA",
      fileName: "recording.webm",
      mimeType: "video/webm",
      sizeBytes: 12000,
      totalParts: 2,
      language: "en"
    });
    const chunk = await postProjectV2RecordingChunk("pv2_7", started.session.id, { partNumber: 1 });
    const status = await getProjectV2RecordingSession("pv2_7", started.session.id);
    const finalized = await finalizeProjectV2RecordingSession("pv2_7", started.session.id, {
      autoTranscribe: true,
      language: "en"
    });
    const canceled = await cancelProjectV2RecordingSession("pv2_7", started.session.id);

    expect(chunk.mode).toBe("UPLOAD_URL");
    expect(status.progress.progressPct).toBe(50);
    expect(finalized.status).toBe("COMPLETED");
    expect(canceled.canceled).toBe(true);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/projects-v2/pv2_7/recordings/session",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/projects-v2/pv2_7/recordings/session/rec_1/chunk",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(3, "/api/projects-v2/pv2_7/recordings/session/rec_1", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "/api/projects-v2/pv2_7/recordings/session/rec_1/finalize",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      5,
      "/api/projects-v2/pv2_7/recordings/session/rec_1/cancel",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("creates chat plan through projects-v2 chat plan endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        planId: "plan_1",
        planRevisionHash: "hash_123456",
        confidence: 0.78,
        requiresConfirmation: true,
        executionMode: "SUGGESTIONS_ONLY",
        opsPreview: [],
        diffGroups: [],
        constrainedSuggestions: [],
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
      planRevisionHash: "hash_123456",
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

  it("fetches editor health snapshot through projects-v2 endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        projectId: "pv2_9",
        legacyProjectId: "legacy_9",
        status: "HEALTHY",
        syncStatus: "IN_SYNC",
        hasRenderableMedia: true,
        queue: { healthy: true, queues: [] },
        render: { readiness: "READY", latest: null, recent: [] },
        ai: { latest: null, recent: [] },
        updatedAt: new Date().toISOString()
      })
    );

    const payload = await getProjectV2EditorHealth("pv2_9");
    expect(payload.status).toBe("HEALTHY");
    expect(fetchSpy).toHaveBeenCalledWith("/api/projects-v2/pv2_9/editor-health", undefined);
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
