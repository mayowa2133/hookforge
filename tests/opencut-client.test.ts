import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyProjectV2AudioEnhancement,
  applyTranscriptOps,
  applyProjectV2ChatEdit,
  applyProjectV2FillerRemoval,
  autoTranscript,
  getProjectV2EditorHealth,
  getProjectV2EditorState,
  getProjectV2Presets,
  getProjectV2,
  getProjectV2AudioAnalysis,
  getProjectV2ChatSessions,
  getOpenCutMetrics,
  getProjectV2RevisionGraph,
  importProjectV2Media,
  getTranscriptIssues,
  getTranscriptRanges,
  patchTimeline,
  patchTranscript,
  previewTranscriptRangeDelete,
  previewProjectV2AudioEnhancement,
  previewProjectV2FillerRemoval,
  previewTranscriptOps,
  registerProjectV2Media,
  searchTranscript,
  planProjectV2ChatEdit,
  applyProjectV2Preset,
  applyTranscriptRangeDelete,
  batchSetTranscriptSpeaker,
  cancelProjectV2RecordingSession,
  finalizeProjectV2RecordingSession,
  startRender,
  startProjectV2RecordingSession,
  trackOpenCutTelemetry,
  undoProjectV2AudioEnhancement,
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

  it("supports transcript ranges, issues, and speaker batch endpoints", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_1",
          projectV2Id: "pv2_4",
          language: "en",
          totalWords: 120,
          totalRanges: 12,
          offset: 0,
          limit: 50,
          hasMore: false,
          nextOffset: null,
          ranges: [
            {
              segmentId: "seg_1",
              startWordIndex: 0,
              endWordIndex: 6,
              startMs: 0,
              endMs: 1200,
              text: "first segment",
              speakerLabel: "Speaker A",
              confidenceAvg: 0.84
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          mode: "PREVIEW",
          selection: {
            startWordIndex: 0,
            endWordIndex: 6,
            startMs: 0,
            endMs: 1200,
            wordCount: 7,
            textPreview: "first segment"
          },
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
          selection: {
            startWordIndex: 0,
            endWordIndex: 6,
            startMs: 0,
            endMs: 1200,
            wordCount: 7,
            textPreview: "first segment"
          },
          applied: true,
          suggestionsOnly: false,
          revisionId: "rev_22",
          issues: [],
          timelineOps: [{ op: "trim_clip" }]
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          affectedSegments: 3,
          applied: true,
          suggestionsOnly: false,
          revisionId: "rev_23",
          issues: [],
          timelineOps: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_1",
          projectV2Id: "pv2_4",
          language: "en",
          minConfidence: 0.86,
          totalIssues: 1,
          byType: {
            LOW_CONFIDENCE: 1,
            OVERLAP: 0,
            TIMING_DRIFT: 0
          },
          issues: [
            {
              id: "low_confidence:seg_1",
              type: "LOW_CONFIDENCE",
              severity: "WARN",
              segmentId: "seg_1",
              startMs: 0,
              endMs: 1200,
              message: "low confidence",
              confidenceAvg: 0.8,
              speakerLabel: "Speaker A"
            }
          ]
        })
      );

    const ranges = await getTranscriptRanges("pv2_4", "en", 0, 50);
    const rangePreview = await previewTranscriptRangeDelete("pv2_4", {
      language: "en",
      selection: { startWordIndex: 0, endWordIndex: 6 },
      minConfidenceForRipple: 0.86
    });
    const rangeApply = await applyTranscriptRangeDelete("pv2_4", {
      language: "en",
      selection: { startWordIndex: 0, endWordIndex: 6 },
      minConfidenceForRipple: 0.86
    });
    const batch = await batchSetTranscriptSpeaker("pv2_4", {
      language: "en",
      fromSpeakerLabel: "Speaker A",
      speakerLabel: "Host",
      maxConfidence: 0.9
    });
    const issues = await getTranscriptIssues("pv2_4", "en", 0.86, 200);

    expect(ranges.totalRanges).toBe(12);
    expect(rangePreview.mode).toBe("PREVIEW");
    expect(rangeApply.mode).toBe("APPLY");
    expect(batch.affectedSegments).toBe(3);
    expect(issues.totalIssues).toBe(1);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/projects-v2/pv2_4/transcript/ranges?language=en&offset=0&limit=50",
      undefined
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/projects-v2/pv2_4/transcript/ranges/preview",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/projects-v2/pv2_4/transcript/ranges/apply",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "/api/projects-v2/pv2_4/transcript/speakers/batch",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      5,
      "/api/projects-v2/pv2_4/transcript/issues?language=en&minConfidence=0.86&limit=200",
      undefined
    );
  });

  it("supports phase3 audio analysis, enhance, filler, and undo endpoints", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_2",
          projectV2Id: "pv2_audio",
          language: "en",
          analysis: {
            timelineDurationMs: 5400,
            audioTrackCount: 1,
            audioClipCount: 1,
            transcriptWordCount: 120,
            averageTrackVolume: 1,
            averageTranscriptConfidence: 0.9,
            estimatedNoiseLevel: 0.1,
            estimatedLoudnessLufs: -15.2,
            fillerCandidateCount: 5,
            recommendedPreset: "dialogue_enhance",
            readyForApply: true
          },
          fillerCandidates: [],
          lastRun: null
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          mode: "PREVIEW",
          runId: "run_preview",
          applied: false,
          suggestionsOnly: false,
          revisionId: null,
          undoToken: null,
          preset: "dialogue_enhance",
          timelineOps: [{ op: "upsert_effect" }],
          issues: [],
          analysisBefore: {
            timelineDurationMs: 5400,
            audioTrackCount: 1,
            audioClipCount: 1,
            transcriptWordCount: 120,
            averageTrackVolume: 1,
            averageTranscriptConfidence: 0.9,
            estimatedNoiseLevel: 0.1,
            estimatedLoudnessLufs: -15.2,
            fillerCandidateCount: 5,
            recommendedPreset: "dialogue_enhance",
            readyForApply: true
          },
          analysisAfter: {
            timelineDurationMs: 5400,
            audioTrackCount: 1,
            audioClipCount: 1,
            transcriptWordCount: 120,
            averageTrackVolume: 1.03,
            averageTranscriptConfidence: 0.9,
            estimatedNoiseLevel: 0.05,
            estimatedLoudnessLufs: -14.4,
            fillerCandidateCount: 5,
            recommendedPreset: "dialogue_enhance",
            readyForApply: true
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          mode: "APPLY",
          runId: "run_apply",
          applied: true,
          suggestionsOnly: false,
          revisionId: "rev_audio",
          undoToken: "undo_audio_1",
          preset: "dialogue_enhance",
          timelineOps: [{ op: "upsert_effect" }],
          issues: [],
          analysisBefore: {
            timelineDurationMs: 5400,
            audioTrackCount: 1,
            audioClipCount: 1,
            transcriptWordCount: 120,
            averageTrackVolume: 1,
            averageTranscriptConfidence: 0.9,
            estimatedNoiseLevel: 0.1,
            estimatedLoudnessLufs: -15.2,
            fillerCandidateCount: 5,
            recommendedPreset: "dialogue_enhance",
            readyForApply: true
          },
          analysisAfter: {
            timelineDurationMs: 5400,
            audioTrackCount: 1,
            audioClipCount: 1,
            transcriptWordCount: 120,
            averageTrackVolume: 1.03,
            averageTranscriptConfidence: 0.9,
            estimatedNoiseLevel: 0.05,
            estimatedLoudnessLufs: -14.4,
            fillerCandidateCount: 5,
            recommendedPreset: "dialogue_enhance",
            readyForApply: true
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          mode: "PREVIEW",
          runId: "run_filler_preview",
          candidateCount: 2,
          candidates: [],
          applied: false,
          suggestionsOnly: true,
          revisionId: null,
          timelineOps: [],
          issues: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          mode: "APPLY",
          runId: "run_filler_apply",
          candidateCount: 2,
          candidates: [],
          applied: true,
          suggestionsOnly: false,
          revisionId: "rev_filler",
          timelineOps: [{ op: "delete_range" }],
          issues: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          restored: true,
          appliedRevisionId: "rev_undo_audio"
        })
      );

    const analysis = await getProjectV2AudioAnalysis("pv2_audio", "en", 80, 0.9);
    const previewEnhance = await previewProjectV2AudioEnhancement("pv2_audio", {
      language: "en",
      preset: "dialogue_enhance",
      targetLufs: -14,
      intensity: 1
    });
    const applyEnhance = await applyProjectV2AudioEnhancement("pv2_audio", {
      language: "en",
      preset: "dialogue_enhance",
      targetLufs: -14,
      intensity: 1
    });
    const previewFiller = await previewProjectV2FillerRemoval("pv2_audio", {
      language: "en",
      maxCandidates: 40
    });
    const applyFiller = await applyProjectV2FillerRemoval("pv2_audio", {
      language: "en",
      maxCandidates: 40
    });
    const undo = await undoProjectV2AudioEnhancement("pv2_audio", "undo_audio_1");

    expect(analysis.analysis.audioTrackCount).toBe(1);
    expect(previewEnhance.mode).toBe("PREVIEW");
    expect(applyEnhance.undoToken).toBe("undo_audio_1");
    expect(previewFiller.mode).toBe("PREVIEW");
    expect(applyFiller.mode).toBe("APPLY");
    expect(undo.restored).toBe(true);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/projects-v2/pv2_audio/audio/analysis?language=en&maxCandidates=80&maxConfidence=0.9",
      undefined
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/projects-v2/pv2_audio/audio/enhance/preview",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/projects-v2/pv2_audio/audio/enhance/apply",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "/api/projects-v2/pv2_audio/audio/filler/preview",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      5,
      "/api/projects-v2/pv2_audio/audio/filler/apply",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      6,
      "/api/projects-v2/pv2_audio/audio/enhance/undo",
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
        executionMode: "APPLIED",
        safetyMode: "APPLY_WITH_CONFIRM",
        confidenceRationale: {
          averageConfidence: 0.78,
          validPlanRate: 98,
          lowConfidence: false,
          reasons: ["Planner confidence medium"],
          fallbackReason: null
        },
        opsPreview: [],
        diffGroups: [
          {
            group: "timeline",
            title: "Timeline Changes",
            summary: "1 operation(s) planned",
            items: [
              {
                id: "timeline-op-1",
                type: "operation",
                label: "1. Split",
                operationIndex: 0
              }
            ]
          }
        ],
        constrainedSuggestions: [],
        issues: []
      })
    );

    const payload = await planProjectV2ChatEdit("pv2_7", {
      prompt: "tighten this section and remove dead air"
    });
    expect(payload.planId).toBe("plan_1");
    expect(payload.safetyMode).toBe("APPLY_WITH_CONFIRM");
    expect(payload.diffGroups[0]?.items[0]?.operationIndex).toBe(0);
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
        undoToken: "undo_1",
        selectedOperationCount: 1,
        totalOperationCount: 2
      })
    );

    const payload = await applyProjectV2ChatEdit("pv2_8", {
      planId: "plan_1",
      planRevisionHash: "hash_123456",
      confirmed: true,
      operationDecisions: [
        { itemId: "timeline-op-1", accepted: true },
        { itemId: "timeline-op-2", accepted: false }
      ]
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

    const payload = await undoProjectV2ChatEdit("pv2_8", { undoToken: "token_12345678", lineageMode: "latest" });
    expect(payload.restored).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects-v2/pv2_8/chat/undo",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("fetches chat sessions through projects-v2 chat sessions endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        projectId: "legacy_10",
        projectV2Id: "pv2_10",
        sessions: [
          {
            planId: "plan_2",
            createdAt: new Date().toISOString(),
            prompt: "tighten pacing",
            executionMode: "APPLIED",
            confidence: 0.86,
            safetyMode: "APPLIED",
            planRevisionHash: "hash_plan_2",
            appliedRevisionId: "rev_2",
            undoToken: "undo_2",
            issueCount: 0,
            diffGroupCount: 4
          }
        ]
      })
    );

    const payload = await getProjectV2ChatSessions("pv2_10", 25);
    expect(payload.sessions.length).toBe(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/projects-v2/pv2_10/chat/sessions?limit=25", undefined);
  });

  it("fetches revision graph through projects-v2 revisions graph endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        projectId: "legacy_10",
        projectV2Id: "pv2_10",
        currentRevisionId: "rev_3",
        nodeCount: 3,
        edgeCount: 2,
        nodes: [],
        edges: []
      })
    );

    const payload = await getProjectV2RevisionGraph("pv2_10", 120);
    expect(payload.nodeCount).toBe(3);
    expect(fetchSpy).toHaveBeenCalledWith("/api/projects-v2/pv2_10/revisions/graph?limit=120", undefined);
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
