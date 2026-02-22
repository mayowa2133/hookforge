import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoTranscript,
  getProjectV2,
  patchTimeline,
  patchTranscript,
  runChatEdit,
  startRender,
  undoChatEdit
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

  it("starts render through bridgeable projects endpoint", async () => {
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
      "/api/projects/pv2_3/render",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("posts timeline operations through bridgeable projects endpoint", async () => {
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
      "/api/projects/pv2_4/timeline",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("runs chat edit through bridgeable projects endpoint and returns mode metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        executionMode: "SUGGESTIONS_ONLY",
        plannedOperations: [],
        validatedOperations: [],
        appliedTimelineOperations: [],
        planValidation: { valid: false, confidence: 0.4, reason: "Low confidence" },
        constrainedSuggestions: ["Try: split clip 1 at 500ms"],
        invariantIssues: [],
        appliedRevisionId: null,
        undoToken: null,
        aiJobId: "ai_1"
      })
    );

    const payload = await runChatEdit("pv2_7", {
      prompt: "tighten this section and remove dead air"
    });
    expect(payload.executionMode).toBe("SUGGESTIONS_ONLY");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects/pv2_7/chat-edit",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("runs chat undo through bridgeable projects endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse({
        restored: true,
        appliedRevisionId: "rev_undo_1"
      })
    );

    const payload = await undoChatEdit("pv2_8", { undoToken: "token_12345678" });
    expect(payload.restored).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects/pv2_8/chat-edit/undo",
      expect.objectContaining({
        method: "POST"
      })
    );
  });
});
