import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyProjectV2ExportProfile,
  applyProjectV2AudioEnhancement,
  applyProjectV2Autopilot,
  applyTranscriptOps,
  applyProjectV2ChatEdit,
  applyProjectV2FillerRemoval,
  createProjectV2ReviewComment,
  createProjectV2ReviewRequest,
  createProjectV2ShareLink,
  autoTranscript,
  getDesktopConfig,
  getProjectV2ExportProfiles,
  getProjectV2PerfHints,
  getProjectV2ReviewComments,
  listProjectV2ReviewRequests,
  getProjectV2ShareLinks,
  getProjectV2BrandPreset,
  getProjectV2PublishJob,
  getOpsQueueHealth,
  getOpsSloSummary,
  getParityLaunchReadiness,
  getProjectV2EditorHealth,
  getProjectV2EditorState,
  getProjectV2Presets,
  getProjectV2,
  getProjectV2AudioAnalysis,
  getProjectV2AudioSegmentAudition,
  getProjectV2ChatSessions,
  getTranscriptConflicts,
  getOpenCutMetrics,
  getProjectV2RevisionGraph,
  getProjectV2AutopilotSessions,
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
  planProjectV2Autopilot,
  applyProjectV2Preset,
  applyTranscriptRangeDelete,
  applyTranscriptSearchReplace,
  batchSetTranscriptSpeaker,
  cancelProjectV2RecordingSession,
  createProjectV2StudioRoom,
  finalizeProjectV2RecordingSession,
  getProjectV2StudioRoom,
  listTranscriptCheckpoints,
  startRender,
  submitProjectV2ReviewDecision,
  decideProjectV2ReviewRequest,
  issueProjectV2StudioJoinToken,
  listProjectV2StudioRooms,
  recoverProjectV2RecordingSession,
  restoreTranscriptCheckpoint,
  startProjectV2RecordingSession,
  startProjectV2StudioRecording,
  stopProjectV2StudioRecording,
  trackOpenCutTelemetry,
  publishProjectV2Connector,
  publishProjectV2ConnectorBatch,
  trackDesktopEvent,
  upsertProjectV2BrandPreset,
  undoProjectV2AudioEnhancement,
  undoProjectV2Autopilot,
  undoProjectV2ChatEdit,
  updateProjectV2ReviewCommentStatus,
  postProjectV2RecordingChunk,
  getProjectV2RecordingSession,
  previewTranscriptSearchReplace,
  createTranscriptCheckpoint,
  replayProjectV2Autopilot
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

  it("supports transcript search-replace, checkpoints, and conflict queue endpoints", async () => {
    const now = new Date().toISOString();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          mode: "PREVIEW",
          query: {
            search: "hook",
            replace: "intro",
            caseSensitive: false
          },
          affectedSegments: 2,
          matches: [
            {
              segmentId: "seg_1",
              before: "great hook",
              after: "great intro",
              startMs: 0,
              endMs: 800,
              confidenceAvg: 0.9
            }
          ],
          applied: false,
          suggestionsOnly: false,
          revisionId: null,
          issues: [],
          timelineOps: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          mode: "APPLY",
          checkpoint: {
            id: "ckpt_1",
            language: "en",
            label: "search-replace:hook",
            createdAt: now
          },
          query: {
            search: "hook",
            replace: "intro",
            caseSensitive: false
          },
          affectedSegments: 2,
          matches: [],
          applied: true,
          suggestionsOnly: false,
          revisionId: "rev_30",
          issues: [],
          timelineOps: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          checkpoint: {
            id: "ckpt_2",
            language: "en",
            label: "manual checkpoint",
            createdAt: now
          }
        }, true, 201)
      )
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_1",
          projectV2Id: "pv2_4",
          checkpoints: [
            {
              id: "ckpt_2",
              language: "en",
              label: "manual checkpoint",
              createdAt: now,
              createdByUserId: "user_1"
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          restored: true,
          checkpointId: "ckpt_2",
          revisionId: "rev_31",
          language: "en",
          restoredSegments: 3,
          restoredWords: 24
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_1",
          projectV2Id: "pv2_4",
          totalConflicts: 1,
          conflicts: [
            {
              id: "conf_1",
              issueType: "TIMING_DRIFT",
              severity: "WARN",
              message: "Timing drift detected.",
              metadata: { issueCode: "timing" },
              checkpointId: "ckpt_2",
              checkpointLabel: "manual checkpoint",
              createdAt: now
            }
          ]
        })
      );

    const preview = await previewTranscriptSearchReplace("pv2_4", {
      language: "en",
      search: "hook",
      replace: "intro"
    });
    const apply = await applyTranscriptSearchReplace("pv2_4", {
      language: "en",
      search: "hook",
      replace: "intro"
    });
    const created = await createTranscriptCheckpoint("pv2_4", {
      language: "en",
      label: "manual checkpoint"
    });
    const checkpoints = await listTranscriptCheckpoints("pv2_4", "en");
    const restored = await restoreTranscriptCheckpoint("pv2_4", "ckpt_2");
    const conflicts = await getTranscriptConflicts("pv2_4", {
      language: "en",
      limit: 50
    });

    expect(preview.mode).toBe("PREVIEW");
    expect(apply.mode).toBe("APPLY");
    expect(created.checkpoint.id).toBe("ckpt_2");
    expect(checkpoints.checkpoints).toHaveLength(1);
    expect(restored.restored).toBe(true);
    expect(conflicts.totalConflicts).toBe(1);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/projects-v2/pv2_4/transcript/search-replace/preview",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/projects-v2/pv2_4/transcript/search-replace/apply",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/projects-v2/pv2_4/transcript/checkpoints/create",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(4, "/api/projects-v2/pv2_4/transcript/checkpoints?language=en", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      5,
      "/api/projects-v2/pv2_4/transcript/checkpoints/ckpt_2/restore",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(6, "/api/projects-v2/pv2_4/transcript/conflicts?language=en&limit=50", undefined);
  });

  it("supports phase5 collaboration and export profile endpoints", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse({ projectId: "legacy_1", projectV2Id: "pv2_9", shareLinks: [] }))
      .mockResolvedValueOnce(mockResponse({
        shareLink: {
          id: "sl_1",
          scope: "COMMENT",
          expiresAt: null,
          revokedAt: null,
          createdAt: new Date().toISOString(),
          shareUrl: "https://example.com/share"
        }
      }))
      .mockResolvedValueOnce(mockResponse({
        projectId: "legacy_1",
        projectV2Id: "pv2_9",
        reviewGate: { approvalRequired: true, latestDecision: null },
        comments: []
      }))
      .mockResolvedValueOnce(mockResponse({
        comment: {
          id: "rc_1",
          body: "test",
          status: "OPEN",
          anchorMs: 100,
          transcriptStartMs: null,
          transcriptEndMs: null,
          timelineTrackId: null,
          clipId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          author: null
        }
      }))
      .mockResolvedValueOnce(mockResponse({ comment: { id: "rc_1", status: "RESOLVED", resolvedAt: new Date().toISOString(), resolvedByUserId: "u_1" } }))
      .mockResolvedValueOnce(mockResponse({ decision: { id: "rd_1", status: "APPROVED", revisionId: "rev_1", note: null, createdAt: new Date().toISOString() }, approvalRequired: true }))
      .mockResolvedValueOnce(mockResponse({ workspaceId: "ws_1", projectV2Id: "pv2_9", exportProfiles: [] }))
      .mockResolvedValueOnce(mockResponse({
        applied: true,
        profile: {
          id: "ep_1",
          name: "Social",
          container: "mp4",
          resolution: "1080x1920",
          fps: 30,
          videoBitrateKbps: null,
          audioBitrateKbps: null,
          audioPreset: null,
          captionStylePresetId: null,
          isDefault: false
        },
        exportProfiles: []
      }));

    await getProjectV2ShareLinks("pv2_9");
    await createProjectV2ShareLink("pv2_9", { scope: "COMMENT", expiresInDays: 7 });
    await getProjectV2ReviewComments("pv2_9", "token_1");
    await createProjectV2ReviewComment("pv2_9", { body: "test", anchorMs: 100 });
    await updateProjectV2ReviewCommentStatus("pv2_9", "rc_1", { status: "RESOLVED" });
    await submitProjectV2ReviewDecision("pv2_9", { status: "APPROVED", requireApproval: true });
    await getProjectV2ExportProfiles("pv2_9");
    await applyProjectV2ExportProfile("pv2_9", { createProfile: { name: "Social" } });

    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/api/projects-v2/pv2_9/share-links", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(3, "/api/projects-v2/pv2_9/review/comments?shareToken=token_1", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(7, "/api/projects-v2/pv2_9/export/profile", undefined);
  });

  it("supports desktop config/events and project perf-hints endpoints", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          desktop: { supported: true, shell: "web-first-desktop-shell", status: "beta-ready" },
          cutover: { defaultEditorShell: "OPENCUT", immediateReplacement: true, legacyFallbackAllowlistEnabled: false },
          budgets: { editorOpenP95Ms: 2500, commandLatencyP95Ms: 100 },
          nativeMenu: [],
          shortcuts: { transport: [], timeline: [], transcript: [] },
          endpoints: {
            desktopEvents: "/api/desktop/events",
            projectPerfHints: "/api/projects-v2/:id/perf-hints",
            queueHealth: "/api/ops/queues/health"
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "pv2_1",
          legacyProjectId: "legacy_1",
          counts: { tracks: 2, clips: 8, transcriptSegments: 16, transcriptWords: 120 },
          budgets: { editorOpenP95Ms: 2500, commandLatencyP95Ms: 100 },
          observed: { editorOpenP95Ms: 1800, commandLatencyP95Ms: 74 },
          suggested: { timelineWindowSize: 60, segmentWindowSize: 220, enableLaneCollapse: false, preferredZoomPercent: 100 },
          hints: [],
          updatedAt: new Date().toISOString()
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          tracked: true,
          eventId: "evt_1",
          createdAt: new Date().toISOString()
        }, true, 201)
      );

    const config = await getDesktopConfig();
    const perf = await getProjectV2PerfHints("pv2_1");
    const tracked = await trackDesktopEvent({
      projectId: "pv2_1",
      event: "command_latency",
      durationMs: 88,
      outcome: "SUCCESS"
    });

    expect(config.desktop.supported).toBe(true);
    expect(perf.budgets.commandLatencyP95Ms).toBe(100);
    expect(tracked.tracked).toBe(true);
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/api/desktop/config", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/projects-v2/pv2_1/perf-hints", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/desktop/events",
      expect.objectContaining({ method: "POST" })
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
          safetyMode: "AUTO_APPLY",
          confidenceScore: 0.92,
          safetyReasons: ["Validation checks passed with strong confidence."],
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
          safetyMode: "AUTO_APPLY",
          confidenceScore: 0.92,
          safetyReasons: ["Validation checks passed with strong confidence."],
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
          safetyMode: "APPLY_WITH_CONFIRM",
          confidenceScore: 0.8,
          safetyReasons: ["Large candidate batch requires explicit confirmation."],
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
          safetyMode: "AUTO_APPLY",
          confidenceScore: 0.9,
          safetyReasons: ["Candidate confidence is high and batch size is safe."],
          revisionId: "rev_filler",
          timelineOps: [{ op: "delete_range" }],
          issues: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_2",
          projectV2Id: "pv2_audio",
          language: "en",
          segment: {
            startMs: 0,
            endMs: 1800,
            durationMs: 1800
          },
          run: {
            id: "run_apply",
            operation: "ENHANCE",
            mode: "APPLY",
            status: "APPLIED",
            createdAt: new Date().toISOString()
          },
          audition: {
            beforeLabel: "Original",
            afterLabel: "Enhanced",
            supported: true,
            transcriptSnippet: "hello world",
            recommendedLoopCount: 3,
            note: "Use solo preview for focused audition and bypass to compare against original."
          }
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
      deEsser: true,
      targetLufs: -14,
      intensity: 1
    });
    const applyEnhance = await applyProjectV2AudioEnhancement("pv2_audio", {
      language: "en",
      preset: "dialogue_enhance",
      confirmed: true,
      targetLufs: -14,
      intensity: 1
    });
    const previewFiller = await previewProjectV2FillerRemoval("pv2_audio", {
      language: "en",
      maxCandidates: 40
    });
    const applyFiller = await applyProjectV2FillerRemoval("pv2_audio", {
      language: "en",
      maxCandidates: 40,
      confirmed: true
    });
    const ab = await getProjectV2AudioSegmentAudition("pv2_audio", {
      runId: "run_apply",
      startMs: 0,
      endMs: 1800,
      language: "en"
    });
    const undo = await undoProjectV2AudioEnhancement("pv2_audio", "undo_audio_1");

    expect(analysis.analysis.audioTrackCount).toBe(1);
    expect(previewEnhance.mode).toBe("PREVIEW");
    expect(applyEnhance.undoToken).toBe("undo_audio_1");
    expect(previewFiller.mode).toBe("PREVIEW");
    expect(applyFiller.mode).toBe("APPLY");
    expect(ab.audition.supported).toBe(true);
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
      "/api/projects-v2/pv2_audio/audio/ab/segment",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      7,
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
            cancelEndpoint: "/api/projects-v2/pv2_7/recordings/session/rec_1/cancel",
            recoverEndpoint: "/api/projects-v2/pv2_7/recordings/session/rec_1/recover"
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
      .mockResolvedValueOnce(mockResponse({ canceled: true, status: "CANCELED" }))
      .mockResolvedValueOnce(mockResponse({
        sessionId: "rec_1",
        recoverable: true,
        resumed: true,
        status: "ACTIVE",
        progress: {
          totalParts: 2,
          completedParts: 1,
          remainingParts: 1,
          missingPartNumbers: [2],
          uploadedPartNumbers: [1],
          progressPct: 50
        },
        state: {
          phase: "RESUMED",
          failedReason: null
        }
      }));

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
    const recovered = await recoverProjectV2RecordingSession("pv2_7", started.session.id, { mode: "resume" });

    expect(chunk.mode).toBe("UPLOAD_URL");
    expect(status.progress.progressPct).toBe(50);
    expect(finalized.status).toBe("COMPLETED");
    expect(canceled.canceled).toBe(true);
    expect(recovered.resumed).toBe(true);
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
    expect(fetchSpy).toHaveBeenNthCalledWith(
      6,
      "/api/projects-v2/pv2_7/recordings/session/rec_1/recover",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("supports studio room list/create/join/start/stop APIs", async () => {
    const now = new Date().toISOString();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockResponse({
        projectId: "pv2_8",
        rooms: [
          {
            id: "room_1",
            projectId: "pv2_8",
            provider: "LIVEKIT_MANAGED",
            roomName: "team-standup",
            status: "ACTIVE",
            metadata: {},
            startedAt: null,
            endedAt: null,
            createdAt: now,
            updatedAt: now,
            participantCount: 1,
            artifactCount: 0
          }
        ]
      }))
      .mockResolvedValueOnce(mockResponse({
        room: {
          id: "room_2",
          projectId: "pv2_8",
          provider: "LIVEKIT_MANAGED",
          roomName: "launch-room",
          status: "ACTIVE",
          metadata: {},
          createdAt: now
        }
      }))
      .mockResolvedValueOnce(mockResponse({
        room: {
          id: "room_2",
          projectId: "pv2_8",
          provider: "LIVEKIT_MANAGED",
          roomName: "launch-room",
          status: "ACTIVE",
          metadata: {},
          startedAt: now,
          endedAt: null,
          createdAt: now,
          updatedAt: now
        },
        participants: [
          {
            id: "participant_1",
            userId: "user_1",
            role: "HOST",
            displayName: "Host",
            externalParticipantId: "studio-abc",
            joinedAt: now,
            leftAt: null,
            trackMetadata: {}
          }
        ]
      }))
      .mockResolvedValueOnce(mockResponse({
        join: {
          roomId: "room_2",
          roomName: "launch-room",
          provider: "LIVEKIT_MANAGED",
          livekitUrl: "wss://livekit.test",
          token: "lk_test_token",
          expiresInSec: 3600,
          participant: {
            id: "participant_2",
            identity: "studio-def",
            displayName: "Guest",
            role: "GUEST"
          }
        }
      }))
      .mockResolvedValueOnce(mockResponse({
        started: true,
        room: {
          id: "room_2",
          status: "ACTIVE",
          startedAt: now
        }
      }))
      .mockResolvedValueOnce(mockResponse({
        stopped: true,
        room: {
          id: "room_2",
          status: "CLOSED",
          endedAt: now
        },
        artifactsCreated: 3,
        timeline: {
          linked: true,
          generatedClipCount: 3,
          durationSec: 12
        }
      }));

    const listed = await listProjectV2StudioRooms("pv2_8");
    const created = await createProjectV2StudioRoom("pv2_8", { name: "Launch Room", region: "us-east" });
    const details = await getProjectV2StudioRoom("pv2_8", "room_2");
    const token = await issueProjectV2StudioJoinToken("pv2_8", "room_2", {
      participantName: "Guest",
      role: "GUEST",
      ttlSec: 3600
    });
    const started = await startProjectV2StudioRecording("pv2_8", "room_2");
    const stopped = await stopProjectV2StudioRecording("pv2_8", "room_2");

    expect(listed.rooms).toHaveLength(1);
    expect(created.room.id).toBe("room_2");
    expect(details.participants).toHaveLength(1);
    expect(token.join.participant.role).toBe("GUEST");
    expect(started.started).toBe(true);
    expect(stopped.timeline.generatedClipCount).toBe(3);
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/api/projects-v2/pv2_8/studio/rooms", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/projects-v2/pv2_8/studio/rooms",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(3, "/api/projects-v2/pv2_8/studio/rooms/room_2", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "/api/projects-v2/pv2_8/studio/rooms/room_2/join-token",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      5,
      "/api/projects-v2/pv2_8/studio/rooms/room_2/start-recording",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      6,
      "/api/projects-v2/pv2_8/studio/rooms/room_2/stop-recording",
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

  it("fetches ops and launch readiness snapshots", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          workspaceId: "ws_1",
          summary: {
            since: new Date().toISOString(),
            windowHours: 24,
            render: { total: 10, success: 10, successRatePct: 100, p95LatencyMs: 3000 },
            ai: { total: 20, success: 19, successRatePct: 95, p95LatencyMs: 1400 }
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          workspaceId: "ws_1",
          healthy: true,
          queues: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          workspaceId: "ws_1",
          stage: "global",
          generatedAt: new Date().toISOString(),
          rollout: {
            eligibleForStage: true,
            autoRollbackEnabled: true,
            forceRollbackToLegacy: false,
            allowlistSize: 0
          },
          thresholds: {
            minParityScore: 75,
            minRenderSuccessPct: 99,
            minAiSuccessPct: 95,
            maxQueueBacklog: 1200,
            maxQueueFailed: 200,
            maxEditorOpenP95Ms: 2500,
            maxCommandP95Ms: 100
          },
          snapshot: {
            parityScore: 85,
            renderSuccessPct: 100,
            aiSuccessPct: 95,
            queueHealthy: true,
            queueBacklog: 0,
            queueFailed: 0,
            editorOpenP95Ms: 2000,
            commandP95Ms: 80
          },
          guardrails: {
            status: "READY",
            shouldRollback: false,
            triggers: []
          },
          scorecard: {
            overallScore: 85,
            passRate: 100,
            passedModules: 7,
            totalModules: 7
          },
          latestBenchmark: null
        })
      );

    const slo = await getOpsSloSummary(24);
    const queue = await getOpsQueueHealth();
    const launch = await getParityLaunchReadiness();

    expect(slo.summary.windowHours).toBe(24);
    expect(queue.healthy).toBe(true);
    expect(launch.guardrails.status).toBe("READY");
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/api/ops/slo/summary?windowHours=24", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/ops/queues/health", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(3, "/api/parity/launch/readiness", undefined);
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

  it("supports autopilot plan/apply/undo/replay/session endpoints", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          sessionId: "auto_sess_1",
          planId: "ai_job_1",
          planRevisionHash: "hash_123456789",
          safetyMode: "APPLY_WITH_CONFIRM",
          confidence: 0.77,
          plannerPack: "timeline",
          macroId: "tighten_pacing",
          macroLabel: "Tighten Pacing",
          confidenceRationale: {
            averageConfidence: 0.77,
            validPlanRate: 98.4,
            lowConfidence: false,
            reasons: [],
            fallbackReason: null
          },
          diffGroups: [
            {
              group: "timeline",
              title: "Timeline Changes",
              summary: "2 operation(s) planned",
              items: [
                { id: "timeline-op-1", type: "operation", label: "1. Split Clip", operationIndex: 0 },
                { id: "timeline-op-2", type: "operation", label: "2. Trim Clip", operationIndex: 1 }
              ]
            }
          ],
          opsPreview: [{ op: "split_clip" }, { op: "trim_clip" }],
          constrainedSuggestions: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          sessionId: "auto_sess_1",
          applied: true,
          suggestionsOnly: false,
          issues: [],
          revisionId: "rev_99",
          undoToken: "undo_99",
          selectedOperationCount: 2,
          totalOperationCount: 2
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          restored: true,
          appliedRevisionId: "rev_98"
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          replayedFromSessionId: "auto_sess_1",
          newSessionId: "auto_sess_2",
          applied: false,
          requiresExplicitDecisions: true,
          plan: {
            sessionId: "auto_sess_2",
            planId: "ai_job_2",
            planRevisionHash: "hash_987654321",
            safetyMode: "APPLY_WITH_CONFIRM",
            confidence: 0.75,
            plannerPack: "timeline",
            macroId: "tighten_pacing",
            macroLabel: "Tighten Pacing",
            confidenceRationale: {
              averageConfidence: 0.75,
              validPlanRate: 96.2,
              lowConfidence: false,
              reasons: [],
              fallbackReason: null
            },
            diffGroups: [],
            opsPreview: [],
            constrainedSuggestions: []
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_11",
          projectV2Id: "pv2_11",
          sessions: [
            {
              id: "auto_sess_1",
              prompt: "tighten pacing",
              sourcePlanId: "ai_job_1",
              planRevisionHash: "hash_123456789",
              safetyMode: "APPLY_WITH_CONFIRM",
              confidence: 0.77,
              status: "SUCCESS",
              metadata: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              actions: []
            }
          ],
          linkedChatSessions: []
        })
      );

    const plan = await planProjectV2Autopilot("pv2_11", {
      macroId: "tighten_pacing",
      plannerPack: "timeline"
    });
    const apply = await applyProjectV2Autopilot("pv2_11", {
      sessionId: "auto_sess_1",
      planRevisionHash: "hash_123456789",
      confirmed: true,
      operationDecisions: [
        { itemId: "timeline-op-1", accepted: true },
        { itemId: "timeline-op-2", accepted: true }
      ]
    });
    const undo = await undoProjectV2Autopilot("pv2_11", {
      sessionId: "auto_sess_1",
      undoToken: "undo_99"
    });
    const replay = await replayProjectV2Autopilot("pv2_11", {
      sessionId: "auto_sess_1",
      confirmed: true,
      applyImmediately: true,
      reuseOperationDecisions: true
    });
    const sessions = await getProjectV2AutopilotSessions("pv2_11", 25);

    expect(plan.sessionId).toBe("auto_sess_1");
    expect(apply.applied).toBe(true);
    expect(undo.restored).toBe(true);
    expect(replay.newSessionId).toBe("auto_sess_2");
    expect(sessions.sessions.length).toBe(1);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/projects-v2/pv2_11/autopilot/plan",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/projects-v2/pv2_11/autopilot/apply",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/projects-v2/pv2_11/autopilot/undo",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "/api/projects-v2/pv2_11/autopilot/replay",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      5,
      "/api/projects-v2/pv2_11/autopilot/sessions?limit=25",
      undefined
    );
  });

  it("supports review requests, brand presets, and publish connectors", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_12",
          projectV2Id: "pv2_12",
          requests: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          request: {
            id: "req_1",
            status: "PENDING",
            title: "Final review",
            note: "Please approve",
            requiredScopes: ["APPROVE"],
            createdAt: new Date().toISOString()
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          request: {
            id: "req_1",
            status: "APPROVED",
            decisionId: "dec_1",
            decidedAt: new Date().toISOString(),
            decidedByUserId: "user_1"
          },
          decision: {
            id: "dec_1",
            status: "APPROVED",
            revisionId: null,
            note: null,
            createdAt: new Date().toISOString()
          },
          logId: "log_1"
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          workspaceId: "ws_1",
          projectV2Id: "pv2_12",
          brandPreset: {
            id: null,
            name: "Default Brand Preset",
            captionStylePresetId: null,
            audioPreset: null,
            defaultConnector: "package",
            defaultVisibility: "private",
            defaultTitlePrefix: null,
            defaultTags: [],
            metadata: {},
            createdAt: null,
            updatedAt: null
          },
          exportProfileDefaults: null,
          captionStylePresets: []
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          workspaceId: "ws_1",
          projectV2Id: "pv2_12",
          brandPreset: {
            id: "brand_1",
            name: "Creator Kit",
            captionStylePresetId: null,
            audioPreset: "dialogue_enhance",
            defaultConnector: "youtube",
            defaultVisibility: "unlisted",
            defaultTitlePrefix: "HookForge",
            defaultTags: ["saas"],
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          linkedExportProfile: {
            id: "profile_1",
            name: "Creator Kit Default Export",
            isDefault: true,
            audioPreset: "dialogue_enhance",
            captionStylePresetId: null,
            updatedAt: new Date().toISOString()
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_12",
          projectV2Id: "pv2_12",
          publishJob: {
            id: "job_1",
            connector: "youtube",
            status: "DONE",
            output: {},
            errorMessage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_12",
          projectV2Id: "pv2_12",
          jobs: [
            {
              id: "job_2",
              connector: "youtube",
              status: "DONE",
              output: {},
              errorMessage: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            {
              id: "job_3",
              connector: "package",
              status: "DONE",
              output: {},
              errorMessage: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ],
          summary: {
            total: 2,
            done: 2,
            error: 0
          }
        })
      )
      .mockResolvedValueOnce(
        mockResponse({
          projectId: "legacy_12",
          projectV2Id: "pv2_12",
          publishJob: {
            id: "job_1",
            connector: "youtube",
            status: "DONE",
            payload: {},
            output: {},
            errorMessage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        })
      );

    const list = await listProjectV2ReviewRequests("pv2_12", 20);
    const created = await createProjectV2ReviewRequest("pv2_12", {
      title: "Final review",
      requiredScopes: ["APPROVE"]
    });
    const decided = await decideProjectV2ReviewRequest("pv2_12", "req_1", {
      status: "APPROVED"
    });
    const brand = await getProjectV2BrandPreset("pv2_12");
    const brandSaved = await upsertProjectV2BrandPreset("pv2_12", {
      name: "Creator Kit",
      defaultConnector: "youtube",
      defaultVisibility: "unlisted",
      defaultTitlePrefix: "HookForge"
    });
    const publishOne = await publishProjectV2Connector("pv2_12", "youtube", {
      title: "Episode export"
    });
    const publishBatch = await publishProjectV2ConnectorBatch("pv2_12", {
      connectors: ["youtube", "package"],
      baseInput: {
        visibility: "private"
      }
    });
    const publishJob = await getProjectV2PublishJob("pv2_12", "job_1");

    expect(list.requests).toHaveLength(0);
    expect(created.request.id).toBe("req_1");
    expect(decided.request.status).toBe("APPROVED");
    expect(brand.brandPreset.defaultConnector).toBe("package");
    expect(brandSaved.brandPreset.id).toBe("brand_1");
    expect(publishOne.publishJob.id).toBe("job_1");
    expect(publishBatch.summary.total).toBe(2);
    expect(publishJob.publishJob.status).toBe("DONE");

    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/api/projects-v2/pv2_12/review/requests?limit=20", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/api/projects-v2/pv2_12/review/requests", expect.objectContaining({ method: "POST" }));
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/projects-v2/pv2_12/review/requests/req_1/decision",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(4, "/api/projects-v2/pv2_12/brand-preset", undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(5, "/api/projects-v2/pv2_12/brand-preset", expect.objectContaining({ method: "POST" }));
    expect(fetchSpy).toHaveBeenNthCalledWith(6, "/api/projects-v2/pv2_12/publish/connectors/youtube/export", expect.objectContaining({ method: "POST" }));
    expect(fetchSpy).toHaveBeenNthCalledWith(7, "/api/projects-v2/pv2_12/publish/connectors/batch/export", expect.objectContaining({ method: "POST" }));
    expect(fetchSpy).toHaveBeenNthCalledWith(8, "/api/projects-v2/pv2_12/publish/jobs/job_1", undefined);
  });
});
