"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  applyProjectV2ChatEdit,
  applyTranscriptOps,
  autoTranscript,
  getAiJob,
  getLegacyProject,
  getProjectV2EditorHealth,
  getRenderJob,
  getTimeline,
  getTranscript,
  patchTimeline,
  planProjectV2ChatEdit,
  previewTranscriptOps,
  searchTranscript,
  startRender,
  trackOpenCutTelemetry,
  undoProjectV2ChatEdit,
  type ChatApplyResponse,
  type ChatPlanResponse,
  type EditorHealthStatus,
  type LegacyProjectPayload,
  type TimelineOperation,
  type TimelinePayload,
  type TranscriptPayload,
  type TranscriptRangeSelection
} from "@/lib/opencut/hookforge-client";
import { clampPlaybackSeekSeconds, computeSplitPointMs, computeTrackReorderTarget } from "@/lib/opencut/timeline-helpers";

type OpenCutTranscriptShellProps = {
  projectV2Id: string;
  legacyProjectId: string;
  title: string;
  status: string;
};

type OperationHistoryEntry = {
  id: string;
  label: string;
  detail: string;
  createdAt: string;
  status: "SUCCESS" | "INFO" | "ERROR";
};

type AutosaveStatus = "SAVED" | "SAVING" | "ERROR";

function formatMs(ms: number) {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((safe % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}

function safeRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, numerator / denominator));
}

function pickPreviewAsset(project: LegacyProjectPayload["project"] | null) {
  if (!project) {
    return null;
  }
  return (
    project.assets.find((asset) => asset.slotKey === "main" && asset.kind === "VIDEO") ??
    project.assets.find((asset) => asset.slotKey === "foreground" && asset.kind === "VIDEO") ??
    project.assets.find((asset) => asset.slotKey === "top" && asset.kind === "VIDEO") ??
    project.assets.find((asset) => asset.kind === "VIDEO") ??
    null
  );
}

function isTypingTarget(eventTarget: EventTarget | null) {
  const element = eventTarget as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
}

function buildHistoryEntry(input: Omit<OperationHistoryEntry, "id" | "createdAt">): OperationHistoryEntry {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...input
  };
}

function confidenceBadge(confidence: number | null, minConfidence: number) {
  if (confidence === null) {
    return { label: "No score", variant: "outline" as const, className: "text-muted-foreground" };
  }
  if (confidence < minConfidence) {
    return { label: `Low ${confidence.toFixed(2)}`, variant: "outline" as const, className: "border-destructive/70 text-destructive" };
  }
  return { label: `${confidence.toFixed(2)}`, variant: "secondary" as const, className: "" };
}

export function OpenCutTranscriptShell({ projectV2Id, legacyProjectId, title, status }: OpenCutTranscriptShellProps) {
  const [project, setProject] = useState<LegacyProjectPayload["project"] | null>(null);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
  const [health, setHealth] = useState<EditorHealthStatus | null>(null);
  const [language, setLanguage] = useState("en");
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [selectedClipId, setSelectedClipId] = useState("");
  const [segmentDraft, setSegmentDraft] = useState("");
  const [speakerDraft, setSpeakerDraft] = useState("");
  const [deleteStartMs, setDeleteStartMs] = useState("0");
  const [deleteEndMs, setDeleteEndMs] = useState("240");
  const [clipMoveInMs, setClipMoveInMs] = useState("0");
  const [clipDurationMs, setClipDurationMs] = useState("1200");
  const [trimStartMs, setTrimStartMs] = useState("0");
  const [trimEndMs, setTrimEndMs] = useState("0");
  const [playheadMs, setPlayheadMs] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("SAVED");
  const [operationHistory, setOperationHistory] = useState<OperationHistoryEntry[]>([]);
  const [minConfidenceForRipple, setMinConfidenceForRipple] = useState(0.86);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<Array<{
    segmentId: string;
    startMs: number;
    endMs: number;
    text: string;
    confidenceAvg: number | null;
    matchStart: number;
    matchEnd: number;
  }>>([]);
  const [rangeSelection, setRangeSelection] = useState<TranscriptRangeSelection>({
    startWordIndex: 0,
    endWordIndex: 0
  });
  const [lastTranscriptPreview, setLastTranscriptPreview] = useState<{
    applied: boolean;
    suggestionsOnly: boolean;
    revisionId: string | null;
    issues: Array<{ code: string; message: string; severity: "INFO" | "WARN" | "ERROR" }>;
    timelineOps: Array<{ op: string; [key: string]: unknown }>;
  } | null>(null);
  const [timelineResult, setTimelineResult] = useState<{ revisionId: string | null; revision: number } | null>(null);
  const [autoJobId, setAutoJobId] = useState<string | null>(null);
  const [autoJobStatus, setAutoJobStatus] = useState<{ status: string; progress: number } | null>(null);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<{
    status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
    progress: number;
    outputUrl: string | null;
    errorMessage: string | null;
  } | null>(null);
  const [timelineExpanded, setTimelineExpanded] = useState(true);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [collapsedTracks, setCollapsedTracks] = useState<Record<string, boolean>>({});
  const [segmentWindowStart, setSegmentWindowStart] = useState(0);
  const [timelineWindowStart, setTimelineWindowStart] = useState(0);
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatPlan, setChatPlan] = useState<ChatPlanResponse | null>(null);
  const [chatApplyResult, setChatApplyResult] = useState<ChatApplyResponse | null>(null);
  const [chatUndoToken, setChatUndoToken] = useState<string | null>(null);
  const [chatUndoResult, setChatUndoResult] = useState<{ restored: boolean; appliedRevisionId: string } | null>(null);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const openedTelemetryRef = useRef(false);

  const orderedTracks = useMemo(() => {
    const tracks = timeline?.timeline.tracks ?? [];
    return [...tracks].sort((a, b) => a.order - b.order);
  }, [timeline?.timeline.tracks]);

  const selectedSegment = useMemo(
    () => transcript?.segments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [selectedSegmentId, transcript?.segments]
  );

  const selectedTrack = useMemo(
    () => orderedTracks.find((track) => track.id === selectedTrackId) ?? null,
    [orderedTracks, selectedTrackId]
  );

  const selectedClip = useMemo(() => {
    if (!selectedTrack) {
      return null;
    }
    return selectedTrack.clips.find((clip) => clip.id === selectedClipId) ?? null;
  }, [selectedClipId, selectedTrack]);

  const previewAsset = useMemo(() => pickPreviewAsset(project), [project]);
  const segmentWindowSize = 220;
  const timelineWindowSize = 60;
  const totalSegments = transcript?.segments.length ?? 0;

  const visibleSegments = useMemo(
    () => transcript?.segments.slice(segmentWindowStart, segmentWindowStart + segmentWindowSize) ?? [],
    [segmentWindowStart, transcript?.segments]
  );

  const visibleTracks = useMemo(
    () => orderedTracks.slice(timelineWindowStart, timelineWindowStart + timelineWindowSize),
    [orderedTracks, timelineWindowStart]
  );

  const appendHistory = useCallback((entry: Omit<OperationHistoryEntry, "id" | "createdAt">) => {
    setOperationHistory((previous) => [buildHistoryEntry(entry), ...previous].slice(0, 30));
  }, []);

  const syncSelectedClipDraft = useCallback((trackId: string, clipId: string, sourceTimeline?: TimelinePayload | null) => {
    const state = sourceTimeline ?? timeline;
    if (!state) {
      return;
    }
    const track = state.timeline.tracks.find((item) => item.id === trackId);
    const clip = track?.clips.find((item) => item.id === clipId);
    if (!track || !clip) {
      return;
    }
    setSelectedTrackId(track.id);
    setSelectedClipId(clip.id);
    setClipMoveInMs(String(clip.timelineInMs));
    setClipDurationMs(String(Math.max(120, clip.timelineOutMs - clip.timelineInMs)));
    setTrimStartMs("0");
    setTrimEndMs("0");
  }, [timeline]);

  const loadProjectSurface = useCallback(async () => {
    const [projectPayload, timelinePayload, healthPayload] = await Promise.all([
      getLegacyProject(projectV2Id),
      getTimeline(projectV2Id),
      getProjectV2EditorHealth(projectV2Id)
    ]);
    setProject(projectPayload.project);
    setTimeline(timelinePayload);
    setHealth(healthPayload);
  }, [projectV2Id]);

  const loadTranscript = useCallback(async () => {
    const next = await getTranscript(projectV2Id, language);
    setTranscript(next);
    if (next.segments.length === 0) {
      setSelectedSegmentId("");
      setSegmentDraft("");
      setSpeakerDraft("");
      return;
    }
    const keepCurrent = next.segments.find((segment) => segment.id === selectedSegmentId);
    const active = keepCurrent ?? next.segments[0];
    setSelectedSegmentId(active.id);
    setSegmentDraft(active.text);
    setSpeakerDraft(active.speakerLabel ?? "");
    setDeleteStartMs(String(active.startMs));
    setDeleteEndMs(String(Math.min(active.endMs, active.startMs + 240)));
  }, [language, projectV2Id, selectedSegmentId]);

  useEffect(() => {
    let canceled = false;
    const load = async () => {
      try {
        setPanelError(null);
        await Promise.all([loadProjectSurface(), loadTranscript()]);
      } catch (error) {
        if (!canceled) {
          setPanelError(error instanceof Error ? error.message : "Failed to load editor surface");
        }
      }
    };
    void load();
    return () => {
      canceled = true;
    };
  }, [loadProjectSurface, loadTranscript]);

  useEffect(() => {
    if (openedTelemetryRef.current) {
      return;
    }
    openedTelemetryRef.current = true;
    void trackOpenCutTelemetry({
      projectId: projectV2Id,
      event: "editor_open",
      outcome: "INFO"
    }).catch(() => {});
  }, [projectV2Id]);

  useEffect(() => {
    const interval = setInterval(() => {
      void getProjectV2EditorHealth(projectV2Id)
        .then((payload) => setHealth(payload))
        .catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [projectV2Id]);

  useEffect(() => {
    if (!orderedTracks.length) {
      setSelectedTrackId("");
      setSelectedClipId("");
      return;
    }
    const hasTrack = orderedTracks.some((track) => track.id === selectedTrackId);
    const fallbackTrack = hasTrack ? orderedTracks.find((track) => track.id === selectedTrackId) ?? orderedTracks[0] : orderedTracks[0];
    const hasClip = fallbackTrack.clips.some((clip) => clip.id === selectedClipId);
    if (!hasTrack) {
      setSelectedTrackId(fallbackTrack.id);
    }
    if (!hasClip && fallbackTrack.clips[0]) {
      syncSelectedClipDraft(fallbackTrack.id, fallbackTrack.clips[0].id);
    }
  }, [orderedTracks, selectedClipId, selectedTrackId, syncSelectedClipDraft]);

  useEffect(() => {
    if (!selectedSegment) {
      return;
    }
    const firstWordIndex = transcript?.words.findIndex(
      (word) => word.startMs >= selectedSegment.startMs && word.endMs <= selectedSegment.endMs
    ) ?? -1;
    if (firstWordIndex >= 0) {
      const matchingWordCount = transcript?.words.filter(
        (word) => word.startMs >= selectedSegment.startMs && word.endMs <= selectedSegment.endMs
      ).length ?? 1;
      setRangeSelection({
        startWordIndex: firstWordIndex,
        endWordIndex: firstWordIndex + Math.max(0, matchingWordCount - 1)
      });
    }
  }, [selectedSegment, transcript?.words]);

  useEffect(() => {
    if (!autoJobId) {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const payload = await getAiJob(autoJobId);
        setAutoJobStatus({ status: payload.aiJob.status, progress: payload.aiJob.progress });
        if (payload.aiJob.status === "DONE") {
          await Promise.all([loadTranscript(), loadProjectSurface()]);
          appendHistory({
            label: "Transcript auto generation",
            detail: "Auto transcript completed",
            status: "SUCCESS"
          });
          setAutoJobId(null);
        }
        if (payload.aiJob.status === "ERROR" || payload.aiJob.status === "CANCELED") {
          const message = payload.aiJob.errorMessage ?? `Auto transcript job ${payload.aiJob.status.toLowerCase()}`;
          setPanelError(message);
          appendHistory({
            label: "Transcript auto generation",
            detail: message,
            status: "ERROR"
          });
          setAutoJobId(null);
        }
      } catch (error) {
        setPanelError(error instanceof Error ? error.message : "Failed to poll AI job");
        setAutoJobId(null);
      }
    }, 2200);
    return () => clearInterval(interval);
  }, [appendHistory, autoJobId, loadProjectSurface, loadTranscript]);

  useEffect(() => {
    if (!renderJobId) {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const payload = await getRenderJob(renderJobId);
        setRenderStatus(payload.renderJob);
        if (payload.renderJob.status === "DONE") {
          await loadProjectSurface();
          appendHistory({
            label: "Final render",
            detail: `Render completed (${payload.renderJob.id.slice(0, 8)})`,
            status: "SUCCESS"
          });
          void trackOpenCutTelemetry({
            projectId: projectV2Id,
            event: "render_done",
            outcome: "SUCCESS"
          }).catch(() => {});
          setRenderJobId(null);
        }
        if (payload.renderJob.status === "ERROR") {
          appendHistory({
            label: "Final render",
            detail: payload.renderJob.errorMessage ?? "Render failed",
            status: "ERROR"
          });
          void trackOpenCutTelemetry({
            projectId: projectV2Id,
            event: "render_error",
            outcome: "ERROR"
          }).catch(() => {});
          setRenderJobId(null);
        }
      } catch (error) {
        setPanelError(error instanceof Error ? error.message : "Failed to poll render job");
        setRenderJobId(null);
      }
    }, 2200);
    return () => clearInterval(interval);
  }, [appendHistory, loadProjectSurface, projectV2Id, renderJobId]);

  const timelineSelectionContext = useMemo(() => ({
    selectedTrackId: selectedTrackId || null,
    selectedClipId: selectedClipId || null,
    selectedSegmentId: selectedSegmentId || null,
    playheadMs,
    language
  }), [language, playheadMs, selectedClipId, selectedSegmentId, selectedTrackId]);

  const applyTimelineOperations = useCallback(async (operations: TimelineOperation[], action: string, uiIntent: TimelineOperation["uiIntent"] = "manual_edit") => {
    setBusy(action);
    setPanelError(null);
    setTimelineResult(null);
    setAutosaveStatus("SAVING");
    try {
      const payload = await patchTimeline(
        projectV2Id,
        operations.map((operation) => ({
          ...operation,
          selectionContext: operation.selectionContext ?? timelineSelectionContext,
          uiIntent: operation.uiIntent ?? uiIntent
        }))
      );
      setTimeline(payload);
      setTimelineResult({
        revisionId: payload.revisionId,
        revision: payload.revision
      });
      await Promise.all([loadTranscript(), loadProjectSurface()]);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Timeline edit",
        detail: `${action} applied (rev ${payload.revision})`,
        status: "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Timeline operation failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Timeline edit",
        detail: `${action} failed: ${message}`,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  }, [appendHistory, loadProjectSurface, loadTranscript, projectV2Id, timelineSelectionContext]);

  const runTranscriptPreview = useCallback(async (operations: Array<{
    op: "replace_text" | "split_segment" | "merge_segments" | "delete_range" | "set_speaker" | "normalize_punctuation";
    [key: string]: unknown;
  }>, action: string) => {
    setBusy(action);
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const payload = await previewTranscriptOps(projectV2Id, {
        language,
        operations: operations as never[],
        minConfidenceForRipple
      });
      setLastTranscriptPreview(payload);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Transcript preview",
        detail: `${action} preview: ${payload.timelineOps.length} timeline op(s)`,
        status: "INFO"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcript preview failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Transcript preview",
        detail: `${action} failed: ${message}`,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  }, [appendHistory, language, minConfidenceForRipple, projectV2Id]);

  const runTranscriptApply = useCallback(async (operations: Array<{
    op: "replace_text" | "split_segment" | "merge_segments" | "delete_range" | "set_speaker" | "normalize_punctuation";
    [key: string]: unknown;
  }>, action: string) => {
    setBusy(action);
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const payload = await applyTranscriptOps(projectV2Id, {
        language,
        operations: operations as never[],
        minConfidenceForRipple
      });
      setLastTranscriptPreview(payload);
      await Promise.all([loadTranscript(), loadProjectSurface()]);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Transcript apply",
        detail: `${action}: ${payload.suggestionsOnly ? "suggestions only" : "applied"} (${payload.issues.length} issue(s))`,
        status: payload.suggestionsOnly ? "INFO" : "SUCCESS"
      });
      void trackOpenCutTelemetry({
        projectId: projectV2Id,
        event: "transcript_edit_apply",
        outcome: payload.suggestionsOnly ? "INFO" : "SUCCESS",
        metadata: {
          action,
          suggestionsOnly: payload.suggestionsOnly,
          issueCount: payload.issues.length
        }
      }).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcript operation failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Transcript apply",
        detail: `${action} failed: ${message}`,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  }, [appendHistory, language, loadProjectSurface, loadTranscript, minConfidenceForRipple, projectV2Id]);

  const transcriptRangeMs = useMemo(() => {
    const words = transcript?.words ?? [];
    if (words.length === 0) {
      return null;
    }
    const start = Math.max(0, Math.min(rangeSelection.startWordIndex, words.length - 1));
    const end = Math.max(start, Math.min(rangeSelection.endWordIndex, words.length - 1));
    const first = words[start];
    const last = words[end];
    return {
      startMs: first.startMs,
      endMs: last.endMs,
      startIndex: start,
      endIndex: end
    };
  }, [rangeSelection.endWordIndex, rangeSelection.startWordIndex, transcript?.words]);

  const chatConfidenceBand = useMemo(() => {
    const score = chatPlan?.confidence ?? 0;
    if (!chatPlan) {
      return "N/A";
    }
    if (chatPlan.executionMode === "SUGGESTIONS_ONLY" || score < 0.65) {
      return "Suggestions-only";
    }
    if (score < 0.8) {
      return "Apply-with-confirm";
    }
    return "Applied";
  }, [chatPlan]);

  const clipAtSelectedSegment = useMemo(() => {
    if (!selectedSegment) {
      return null;
    }
    for (const track of orderedTracks) {
      const clip = track.clips.find((entry) => selectedSegment.startMs >= entry.timelineInMs && selectedSegment.startMs <= entry.timelineOutMs);
      if (clip) {
        return {
          trackId: track.id,
          clipId: clip.id
        };
      }
    }
    return null;
  }, [orderedTracks, selectedSegment]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || busy !== null) {
        return;
      }
      const video = previewVideoRef.current;
      const key = event.key.toLowerCase();
      const withCommand = event.metaKey || event.ctrlKey;

      if (key === " " && video) {
        event.preventDefault();
        if (video.paused) {
          void video.play();
        } else {
          video.pause();
        }
        return;
      }

      if (video && key === "j") {
        event.preventDefault();
        const next = clampPlaybackSeekSeconds({
          currentSeconds: video.currentTime,
          deltaSeconds: -2,
          durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined
        });
        video.currentTime = next;
        setPlayheadMs(Math.floor(next * 1000));
        return;
      }

      if (video && key === "k") {
        event.preventDefault();
        video.pause();
        return;
      }

      if (video && key === "l") {
        event.preventDefault();
        const next = clampPlaybackSeekSeconds({
          currentSeconds: video.currentTime,
          deltaSeconds: 2,
          durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined
        });
        video.currentTime = next;
        setPlayheadMs(Math.floor(next * 1000));
        return;
      }

      if (selectedTrack && selectedClip && ((withCommand && key === "b") || (!withCommand && key === "s"))) {
        event.preventDefault();
        const splitMs = computeSplitPointMs(
          {
            timelineInMs: selectedClip.timelineInMs,
            timelineOutMs: selectedClip.timelineOutMs
          },
          playheadMs
        );
        void applyTimelineOperations(
          [{ op: "split_clip", trackId: selectedTrack.id, clipId: selectedClip.id, splitMs }],
          "split_clip"
        );
        return;
      }

      if (selectedTrack && selectedClip && event.shiftKey && key === "d") {
        event.preventDefault();
        const durationMs = Math.max(120, selectedClip.timelineOutMs - selectedClip.timelineInMs);
        void applyTimelineOperations(
          [{
            op: "add_clip",
            trackId: selectedTrack.id,
            assetId: selectedClip.assetId,
            slotKey: selectedClip.slotKey,
            label: `${selectedClip.label ?? "Clip"} Copy`,
            timelineInMs: selectedClip.timelineInMs + 120,
            durationMs,
            sourceInMs: selectedClip.sourceInMs,
            sourceOutMs: selectedClip.sourceOutMs
          }],
          "duplicate_clip"
        );
        return;
      }

      if (selectedTrack && selectedClip && (key === "[" || key === "]")) {
        event.preventDefault();
        if (key === "[") {
          const trimStartMs = Math.max(0, playheadMs - selectedClip.timelineInMs);
          void applyTimelineOperations(
            [{ op: "trim_clip", trackId: selectedTrack.id, clipId: selectedClip.id, trimStartMs }],
            "trim_in_to_playhead"
          );
        } else {
          const trimEndMs = Math.max(0, selectedClip.timelineOutMs - playheadMs);
          void applyTimelineOperations(
            [{ op: "trim_clip", trackId: selectedTrack.id, clipId: selectedClip.id, trimEndMs }],
            "trim_out_to_playhead"
          );
        }
        return;
      }

      if ((key === "delete" || key === "backspace") && selectedTrack && selectedClip) {
        event.preventDefault();
        void applyTimelineOperations(
          [{ op: "remove_clip", trackId: selectedTrack.id, clipId: selectedClip.id }],
          "ripple_delete_clip"
        );
        return;
      }

      if ((key === "delete" || key === "backspace") && selectedSegment) {
        event.preventDefault();
        void runTranscriptApply(
          [{ op: "delete_range", startMs: selectedSegment.startMs, endMs: selectedSegment.endMs }],
          "ripple_delete_segment"
        );
        return;
      }

      if (withCommand && event.shiftKey && key === "s" && selectedSegment) {
        event.preventDefault();
        const midpoint = selectedSegment.startMs + Math.floor((selectedSegment.endMs - selectedSegment.startMs) / 2);
        void runTranscriptApply(
          [{ op: "split_segment", segmentId: selectedSegment.id, splitMs: Math.max(selectedSegment.startMs + 80, midpoint) }],
          "split_segment_shortcut"
        );
        return;
      }

      if (withCommand && event.shiftKey && key === "m" && selectedSegment && transcript) {
        event.preventDefault();
        const index = transcript.segments.findIndex((segment) => segment.id === selectedSegment.id);
        const nextSegment = index >= 0 ? transcript.segments[index + 1] : null;
        if (nextSegment) {
          void runTranscriptApply(
            [{ op: "merge_segments", firstSegmentId: selectedSegment.id, secondSegmentId: nextSegment.id }],
            "merge_segment_shortcut"
          );
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyTimelineOperations, busy, playheadMs, runTranscriptApply, selectedClip, selectedSegment, selectedTrack, transcript]);

  const runAutoTranscript = async () => {
    setBusy("auto_transcript");
    setPanelError(null);
    try {
      const payload = await autoTranscript(projectV2Id, {
        language,
        diarization: false,
        punctuationStyle: "auto",
        confidenceThreshold: minConfidenceForRipple,
        reDecodeEnabled: true,
        maxWordsPerSegment: 7,
        maxCharsPerLine: 24,
        maxLinesPerSegment: 2
      });
      setAutoJobId(payload.aiJobId);
      setAutoJobStatus({ status: payload.status, progress: 0 });
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Failed to start transcript generation");
    } finally {
      setBusy(null);
    }
  };

  const runSearch = async () => {
    setBusy("transcript_search");
    setPanelError(null);
    try {
      const query = searchQuery.trim();
      if (query.length < 2) {
        setSearchMatches([]);
        return;
      }
      const payload = await searchTranscript(projectV2Id, language, query);
      setSearchMatches(payload.matches);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setBusy(null);
    }
  };

  const applyReplaceText = async () => {
    if (!selectedSegment || !segmentDraft.trim()) {
      return;
    }
    await runTranscriptApply(
      [{ op: "replace_text", segmentId: selectedSegment.id, text: segmentDraft.trim() }],
      "replace_text"
    );
  };

  const applySplitSegment = async () => {
    if (!selectedSegment) {
      return;
    }
    const midpoint = selectedSegment.startMs + Math.floor((selectedSegment.endMs - selectedSegment.startMs) / 2);
    await runTranscriptApply(
      [{ op: "split_segment", segmentId: selectedSegment.id, splitMs: Math.max(selectedSegment.startMs + 80, midpoint) }],
      "split_segment"
    );
  };

  const applyMergeWithNext = async () => {
    if (!selectedSegment || !transcript) {
      return;
    }
    const index = transcript.segments.findIndex((segment) => segment.id === selectedSegment.id);
    const nextSegment = index >= 0 ? transcript.segments[index + 1] : null;
    if (!nextSegment) {
      return;
    }
    await runTranscriptApply(
      [{ op: "merge_segments", firstSegmentId: selectedSegment.id, secondSegmentId: nextSegment.id }],
      "merge_segment"
    );
  };

  const applySpeaker = async () => {
    if (!selectedSegment) {
      return;
    }
    await runTranscriptApply(
      [{ op: "set_speaker", segmentId: selectedSegment.id, speakerLabel: speakerDraft.trim() || null }],
      "set_speaker"
    );
  };

  const previewRangeDelete = async () => {
    if (!transcriptRangeMs) {
      return;
    }
    await runTranscriptPreview(
      [{ op: "delete_range", startMs: transcriptRangeMs.startMs, endMs: transcriptRangeMs.endMs }],
      "delete_range_preview"
    );
  };

  const applyRangeDelete = async () => {
    if (!transcriptRangeMs) {
      return;
    }
    await runTranscriptApply(
      [{ op: "delete_range", startMs: transcriptRangeMs.startMs, endMs: transcriptRangeMs.endMs }],
      "delete_range_apply"
    );
  };

  const applyManualDeleteRange = async () => {
    const start = Number(deleteStartMs);
    const end = Number(deleteEndMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setPanelError("Delete range requires valid start/end ms.");
      return;
    }
    await runTranscriptApply(
      [{ op: "delete_range", startMs: Math.max(0, Math.floor(start)), endMs: Math.floor(end) }],
      "delete_range_manual"
    );
  };

  const applyNormalizePunctuation = async () => {
    await runTranscriptApply([{ op: "normalize_punctuation" }], "normalize_punctuation");
  };

  const splitTimelineAtPlayhead = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    const splitMs = computeSplitPointMs(
      {
        timelineInMs: selectedClip.timelineInMs,
        timelineOutMs: selectedClip.timelineOutMs
      },
      playheadMs
    );
    await applyTimelineOperations(
      [{ op: "split_clip", trackId: selectedTrack.id, clipId: selectedClip.id, splitMs }],
      "split_clip"
    );
  };

  const trimTimeline = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    await applyTimelineOperations(
      [{
        op: "trim_clip",
        trackId: selectedTrack.id,
        clipId: selectedClip.id,
        trimStartMs: Math.max(0, Math.floor(Number(trimStartMs) || 0)),
        trimEndMs: Math.max(0, Math.floor(Number(trimEndMs) || 0))
      }],
      "trim_clip"
    );
  };

  const moveTimelineClip = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    await applyTimelineOperations(
      [{
        op: "move_clip",
        trackId: selectedTrack.id,
        clipId: selectedClip.id,
        timelineInMs: Math.max(0, Math.floor(Number(clipMoveInMs) || 0))
      }],
      "move_clip"
    );
  };

  const setTimelineClipTiming = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    await applyTimelineOperations(
      [{
        op: "set_clip_timing",
        trackId: selectedTrack.id,
        clipId: selectedClip.id,
        timelineInMs: Math.max(0, Math.floor(Number(clipMoveInMs) || 0)),
        durationMs: Math.max(120, Math.floor(Number(clipDurationMs) || 1200))
      }],
      "set_clip_timing"
    );
  };

  const mergeTimelineClipWithNext = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    await applyTimelineOperations(
      [{ op: "merge_clip_with_next", trackId: selectedTrack.id, clipId: selectedClip.id }],
      "merge_clip_with_next"
    );
  };

  const removeTimelineClip = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    await applyTimelineOperations(
      [{ op: "remove_clip", trackId: selectedTrack.id, clipId: selectedClip.id }],
      "remove_clip"
    );
  };

  const reorderTrack = async (trackId: string, currentOrder: number, direction: -1 | 1) => {
    const nextOrder = computeTrackReorderTarget(currentOrder, direction, orderedTracks.length);
    if (nextOrder === currentOrder) {
      return;
    }
    await applyTimelineOperations(
      [{ op: "reorder_track", trackId, order: nextOrder }],
      "reorder_track"
    );
  };

  const toggleTrackCollapsed = (trackId: string) => {
    setCollapsedTracks((previous) => ({
      ...previous,
      [trackId]: !previous[trackId]
    }));
  };

  const jumpSegmentToTimeline = () => {
    if (!clipAtSelectedSegment) {
      return;
    }
    syncSelectedClipDraft(clipAtSelectedSegment.trackId, clipAtSelectedSegment.clipId);
    const track = orderedTracks.find((entry) => entry.id === clipAtSelectedSegment.trackId);
    const clip = track?.clips.find((entry) => entry.id === clipAtSelectedSegment.clipId);
    if (clip) {
      setPlayheadMs(clip.timelineInMs);
      if (previewVideoRef.current) {
        previewVideoRef.current.currentTime = clip.timelineInMs / 1000;
      }
    }
  };

  const createChatPlan = async () => {
    if (!chatPrompt.trim()) {
      return;
    }
    setBusy("chat_plan");
    setPanelError(null);
    setChatApplyResult(null);
    setChatUndoResult(null);
    try {
      const plan = await planProjectV2ChatEdit(projectV2Id, {
        prompt: chatPrompt.trim()
      });
      setChatPlan(plan);
      appendHistory({
        label: "Chat plan",
        detail: `Plan generated (${plan.executionMode}, confidence ${plan.confidence.toFixed(2)})`,
        status: "INFO"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create chat plan";
      setPanelError(message);
      appendHistory({
        label: "Chat plan",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const applyChatPlan = async () => {
    if (!chatPlan || !chatPlan.planRevisionHash) {
      return;
    }
    setBusy("chat_apply");
    setPanelError(null);
    try {
      const result = await applyProjectV2ChatEdit(projectV2Id, {
        planId: chatPlan.planId,
        planRevisionHash: chatPlan.planRevisionHash,
        confirmed: true
      });
      setChatApplyResult(result);
      setChatUndoToken(result.undoToken);
      await Promise.all([loadProjectSurface(), loadTranscript()]);
      appendHistory({
        label: "Chat apply",
        detail: result.suggestionsOnly ? "Suggestions-only path; no destructive apply" : "Plan applied successfully",
        status: result.suggestionsOnly ? "INFO" : "SUCCESS"
      });
      void trackOpenCutTelemetry({
        projectId: projectV2Id,
        event: "chat_edit_apply",
        outcome: result.suggestionsOnly ? "INFO" : "SUCCESS",
        metadata: {
          issueCount: result.issues.length,
          suggestionsOnly: result.suggestionsOnly
        }
      }).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply chat plan";
      setPanelError(message);
      appendHistory({
        label: "Chat apply",
        detail: message,
        status: "ERROR"
      });
      void trackOpenCutTelemetry({
        projectId: projectV2Id,
        event: "chat_edit_apply",
        outcome: "ERROR",
        metadata: {
          message
        }
      }).catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const undoChat = async () => {
    if (!chatUndoToken) {
      return;
    }
    setBusy("chat_undo");
    setPanelError(null);
    try {
      const response = await undoProjectV2ChatEdit(projectV2Id, {
        undoToken: chatUndoToken
      });
      setChatUndoResult(response);
      setChatApplyResult(null);
      setChatUndoToken(null);
      await Promise.all([loadProjectSurface(), loadTranscript()]);
      appendHistory({
        label: "Chat undo",
        detail: `Restored revision ${response.appliedRevisionId.slice(0, 8)}`,
        status: "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to undo chat apply";
      setPanelError(message);
      appendHistory({
        label: "Chat undo",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const enqueueRender = async () => {
    setBusy("render");
    setPanelError(null);
    try {
      const payload = await startRender(projectV2Id);
      setRenderJobId(payload.renderJob.id);
      setRenderStatus({
        status: payload.renderJob.status as "QUEUED" | "RUNNING" | "DONE" | "ERROR",
        progress: payload.renderJob.progress,
        outputUrl: null,
        errorMessage: null
      });
      appendHistory({
        label: "Render queue",
        detail: `Queued render job ${payload.renderJob.id.slice(0, 8)}`,
        status: "INFO"
      });
      void trackOpenCutTelemetry({
        projectId: projectV2Id,
        event: "render_start",
        outcome: "INFO"
      }).catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Render failed to start";
      setPanelError(message);
      appendHistory({
        label: "Render queue",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const trackCount = orderedTracks.length;
  const clipCount = orderedTracks.reduce((sum, track) => sum + track.clips.length, 0);
  const previewDurationMs = previewVideoRef.current?.duration ? Math.floor(previewVideoRef.current.duration * 1000) : 0;
  const timelineZoomFactor = zoomPercent / 100;

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[720px] flex-col gap-3">
      <div className="flex items-center justify-between rounded-xl border bg-background/95 px-4 py-3 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Descript-first editor</p>
          <h1 className="text-2xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
            {title}
          </h1>
          <p className="text-xs text-muted-foreground">
            Project V2: {projectV2Id.slice(0, 8)} • Legacy bridge: {legacyProjectId} • Status: {status}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={autosaveStatus === "SAVING" ? "secondary" : "outline"}
            className={autosaveStatus === "ERROR" ? "border-destructive/70 text-destructive" : ""}
          >
            Autosave {autosaveStatus}
          </Badge>
          <Badge
            variant={health?.status === "HEALTHY" ? "secondary" : "outline"}
            className={health?.status === "HEALTHY" || health?.status === "WAITING_MEDIA" ? "" : "border-destructive/70 text-destructive"}
          >
            Health {health?.status ?? "UNKNOWN"}
          </Badge>
          <Badge
            variant="outline"
            className={health?.syncStatus === "IN_SYNC" ? "" : "border-destructive/70 text-destructive"}
          >
            Sync {health?.syncStatus ?? "UNKNOWN"}
          </Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[300px_minmax(480px,1fr)_420px]">
        <Card className="min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Media + Scenes</CardTitle>
            <CardDescription>Freeform uploads first. Quick starts remain optional macros.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 overflow-y-auto">
            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Project assets</p>
              <p className="text-muted-foreground">Total {project?.assets.length ?? 0}</p>
              <div className="mt-2 max-h-[160px] space-y-1 overflow-y-auto">
                {(project?.assets ?? []).map((asset) => (
                  <div key={asset.id} className="rounded border px-2 py-1">
                    <p className="font-medium">{asset.slotKey}</p>
                    <p className="text-muted-foreground">
                      {asset.kind} • {asset.mimeType} {asset.durationSec ? `• ${asset.durationSec.toFixed(2)}s` : ""}
                    </p>
                  </div>
                ))}
                {!project?.assets.length ? <p className="text-muted-foreground">No assets yet.</p> : null}
              </div>
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Quick actions</p>
              <div className="mt-2 grid gap-2">
                <Button size="sm" onClick={runAutoTranscript} disabled={busy !== null}>
                  Generate Transcript
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void loadProjectSurface()} disabled={busy !== null}>
                  Refresh Project State
                </Button>
                <Button size="sm" variant="outline" onClick={enqueueRender} disabled={busy !== null || health?.render.readiness === "BLOCKED"}>
                  Render MP4
                </Button>
              </div>
              {autoJobStatus ? (
                <div className="mt-2">
                  <p className="text-muted-foreground">ASR job {autoJobStatus.status} ({autoJobStatus.progress}%)</p>
                  <Progress value={autoJobStatus.progress} />
                </div>
              ) : null}
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Operation history</p>
              <div className="mt-2 max-h-[220px] space-y-1 overflow-y-auto">
                {operationHistory.map((entry) => (
                  <div key={entry.id} className="rounded border px-2 py-1">
                    <p className="font-medium">{entry.label}</p>
                    <p className="text-muted-foreground">{entry.detail}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(entry.createdAt).toLocaleTimeString()}</p>
                  </div>
                ))}
                {!operationHistory.length ? <p className="text-muted-foreground">No operations recorded yet.</p> : null}
              </div>
            </div>

            <div className="rounded-md border p-2 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Shortcuts</p>
              <p>Space/J/K/L playback • Cmd/Ctrl+B split • Delete ripple delete • Shift+D duplicate • [ ] trim to playhead • Cmd/Ctrl+Shift+S split segment • Cmd/Ctrl+Shift+M merge segment.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Transcript (Primary Canvas)</CardTitle>
            <CardDescription>Edit transcript first, with preview-before-apply safety gates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 overflow-y-auto">
            <div className="grid gap-2 md:grid-cols-[80px_1fr_auto]">
              <Input value={language} onChange={(event) => setLanguage(event.target.value)} className="h-8" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search transcript..."
                className="h-8"
              />
              <Button size="sm" variant="secondary" onClick={runSearch} disabled={busy !== null}>
                Search
              </Button>
            </div>

            {searchMatches.length > 0 ? (
              <div className="rounded-md border p-2 text-xs">
                <p className="font-semibold">Search matches ({searchMatches.length})</p>
                <div className="mt-1 max-h-[92px] space-y-1 overflow-y-auto">
                  {searchMatches.slice(0, 12).map((match) => (
                    <button
                      key={`${match.segmentId}-${match.matchStart}`}
                      type="button"
                      onClick={() => {
                        setSelectedSegmentId(match.segmentId);
                        setSegmentWindowStart(Math.max(0, (transcript?.segments.findIndex((segment) => segment.id === match.segmentId) ?? 0) - 8));
                      }}
                      className="w-full rounded border px-2 py-1 text-left hover:bg-muted"
                    >
                      <p className="font-medium">{formatMs(match.startMs)} - {formatMs(match.endMs)}</p>
                      <p className="line-clamp-1 text-muted-foreground">{match.text}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-md border p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">Transcript segments ({totalSegments})</p>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => setSegmentWindowStart(Math.max(0, segmentWindowStart - segmentWindowSize))}
                    disabled={segmentWindowStart === 0}
                  >
                    Prev
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => setSegmentWindowStart(Math.min(Math.max(0, totalSegments - 1), segmentWindowStart + segmentWindowSize))}
                    disabled={segmentWindowStart + segmentWindowSize >= totalSegments}
                  >
                    Next
                  </Button>
                </div>
              </div>
              <div className="mt-2 max-h-[360px] space-y-1 overflow-y-auto">
                {visibleSegments.map((segment) => {
                  const badge = confidenceBadge(segment.confidenceAvg, minConfidenceForRipple);
                  return (
                    <button
                      key={segment.id}
                      type="button"
                      onClick={() => {
                        setSelectedSegmentId(segment.id);
                        setSegmentDraft(segment.text);
                        setSpeakerDraft(segment.speakerLabel ?? "");
                        setDeleteStartMs(String(segment.startMs));
                        setDeleteEndMs(String(Math.min(segment.endMs, segment.startMs + 220)));
                      }}
                      className={`w-full rounded border px-2 py-2 text-left transition ${segment.id === selectedSegmentId ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{formatMs(segment.startMs)} - {formatMs(segment.endMs)}</p>
                        <Badge variant={badge.variant} className={badge.className}>{badge.label}</Badge>
                      </div>
                      <p className="line-clamp-2 text-muted-foreground">{segment.text}</p>
                    </button>
                  );
                })}
                {!visibleSegments.length ? <p className="text-muted-foreground">No transcript yet. Generate one to begin.</p> : null}
              </div>
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Segment editor</p>
              <div className="mt-2 space-y-2">
                <Textarea
                  rows={4}
                  value={segmentDraft}
                  onChange={(event) => setSegmentDraft(event.target.value)}
                  placeholder="Select a segment to edit text"
                />
                <div className="grid gap-2 grid-cols-2">
                  <Button size="sm" onClick={applyReplaceText} disabled={!selectedSegment || busy !== null}>
                    Replace Text
                  </Button>
                  <Button size="sm" variant="secondary" onClick={applySplitSegment} disabled={!selectedSegment || busy !== null}>
                    Split Segment
                  </Button>
                  <Button size="sm" variant="secondary" onClick={applyMergeWithNext} disabled={!selectedSegment || busy !== null}>
                    Merge Next
                  </Button>
                  <Button size="sm" variant="outline" onClick={applyNormalizePunctuation} disabled={busy !== null}>
                    Normalize Punctuation
                  </Button>
                </div>
                <div className="grid gap-2 grid-cols-[1fr_auto]">
                  <Input value={speakerDraft} onChange={(event) => setSpeakerDraft(event.target.value)} placeholder="Speaker label" />
                  <Button size="sm" variant="secondary" onClick={applySpeaker} disabled={!selectedSegment || busy !== null}>
                    Set Speaker
                  </Button>
                </div>
                <div className="grid gap-2 grid-cols-2">
                  <Input value={deleteStartMs} onChange={(event) => setDeleteStartMs(event.target.value)} placeholder="Start ms" />
                  <Input value={deleteEndMs} onChange={(event) => setDeleteEndMs(event.target.value)} placeholder="End ms" />
                </div>
                <Button size="sm" variant="destructive" onClick={applyManualDeleteRange} disabled={busy !== null}>
                  Delete Range (Manual)
                </Button>
              </div>
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Word-range select</p>
              <p className="text-muted-foreground">Use for Descript-style range preview before apply.</p>
              <div className="mt-2 grid gap-2 grid-cols-2">
                <Input
                  type="number"
                  value={rangeSelection.startWordIndex}
                  onChange={(event) => setRangeSelection((previous) => ({ ...previous, startWordIndex: Number(event.target.value) || 0 }))}
                />
                <Input
                  type="number"
                  value={rangeSelection.endWordIndex}
                  onChange={(event) => setRangeSelection((previous) => ({ ...previous, endWordIndex: Number(event.target.value) || 0 }))}
                />
              </div>
              <p className="mt-1 text-muted-foreground">
                {transcriptRangeMs ? `Range ${transcriptRangeMs.startIndex}-${transcriptRangeMs.endIndex} => ${formatMs(transcriptRangeMs.startMs)} to ${formatMs(transcriptRangeMs.endMs)}` : "No valid range"}
              </p>
              <div className="mt-2 grid gap-2 grid-cols-2">
                <Button size="sm" variant="secondary" onClick={previewRangeDelete} disabled={!transcriptRangeMs || busy !== null}>
                  Preview Ripple Delete
                </Button>
                <Button size="sm" variant="destructive" onClick={applyRangeDelete} disabled={!transcriptRangeMs || busy !== null}>
                  Apply Ripple Delete
                </Button>
              </div>
            </div>

            {lastTranscriptPreview ? (
              <div className="rounded-md border p-2 text-xs">
                <p className="font-semibold">
                  {lastTranscriptPreview.suggestionsOnly ? "Suggestions-only" : "Applied/Previewed"}{" "}
                  {lastTranscriptPreview.revisionId ? `(rev ${lastTranscriptPreview.revisionId.slice(0, 8)})` : ""}
                </p>
                <p className="text-muted-foreground">{lastTranscriptPreview.timelineOps.length} timeline op(s)</p>
                {lastTranscriptPreview.issues.length > 0 ? (
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    {lastTranscriptPreview.issues.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>[{issue.severity}] {issue.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-h-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Preview + Inspector + Chat</CardTitle>
            <CardDescription>Plan → review diff → apply with explicit confirmation and one-click undo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 overflow-y-auto">
            {previewAsset ? (
              <video
                ref={previewVideoRef}
                src={previewAsset.signedUrl}
                controls
                playsInline
                onTimeUpdate={(event) => setPlayheadMs(Math.floor(event.currentTarget.currentTime * 1000))}
                className="aspect-[9/16] w-full rounded-md border object-cover"
              />
            ) : (
              <div className="rounded-md border p-4 text-xs text-muted-foreground">No preview video asset yet.</div>
            )}
            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Inspector</p>
              <p className="text-muted-foreground">Playhead: {formatMs(playheadMs)} / {formatMs(previewDurationMs)}</p>
              {selectedSegment ? (
                <p className="text-muted-foreground">
                  Segment: {formatMs(selectedSegment.startMs)}-{formatMs(selectedSegment.endMs)}
                </p>
              ) : null}
              {selectedClip ? (
                <p className="text-muted-foreground">
                  Clip: {(selectedClip.label ?? "Untitled").slice(0, 28)} [{formatMs(selectedClip.timelineInMs)}-{formatMs(selectedClip.timelineOutMs)}]
                </p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="secondary" onClick={jumpSegmentToTimeline} disabled={!clipAtSelectedSegment}>
                  Jump Segment to Clip
                </Button>
                <Button size="sm" onClick={splitTimelineAtPlayhead} disabled={!selectedClip || !selectedTrack || busy !== null}>
                  Split @ Playhead
                </Button>
              </div>
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Timeline clip controls</p>
              {selectedClip && selectedTrack ? (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={clipMoveInMs} onChange={(event) => setClipMoveInMs(event.target.value)} placeholder="timelineInMs" />
                    <Input value={clipDurationMs} onChange={(event) => setClipDurationMs(event.target.value)} placeholder="durationMs" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={trimStartMs} onChange={(event) => setTrimStartMs(event.target.value)} placeholder="trimStartMs" />
                    <Input value={trimEndMs} onChange={(event) => setTrimEndMs(event.target.value)} placeholder="trimEndMs" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" onClick={moveTimelineClip} disabled={busy !== null}>Move</Button>
                    <Button size="sm" variant="secondary" onClick={setTimelineClipTiming} disabled={busy !== null}>Set Timing</Button>
                    <Button size="sm" variant="secondary" onClick={trimTimeline} disabled={busy !== null}>Trim</Button>
                    <Button size="sm" variant="secondary" onClick={splitTimelineAtPlayhead} disabled={busy !== null}>Split</Button>
                    <Button size="sm" variant="outline" onClick={mergeTimelineClipWithNext} disabled={busy !== null}>Merge Next</Button>
                    <Button size="sm" variant="destructive" onClick={removeTimelineClip} disabled={busy !== null}>Remove</Button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-muted-foreground">Select a clip in timeline rail to edit.</p>
              )}
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Chat co-editor</p>
              <Textarea
                rows={3}
                value={chatPrompt}
                onChange={(event) => setChatPrompt(event.target.value)}
                placeholder="Example: tighten intro pacing, split first clip, and bold caption emphasis."
              />
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Button size="sm" onClick={createChatPlan} disabled={busy !== null || !chatPrompt.trim()}>
                  Plan
                </Button>
                <Button size="sm" variant="secondary" onClick={applyChatPlan} disabled={busy !== null || !chatPlan?.planRevisionHash}>
                  Apply
                </Button>
                <Button size="sm" variant="outline" onClick={undoChat} disabled={busy !== null || !chatUndoToken}>
                  Undo
                </Button>
              </div>
              {chatPlan ? (
                <div className="mt-2 rounded border p-2">
                  <p className="font-semibold">
                    Review plan • {chatPlan.executionMode} • confidence {chatPlan.confidence.toFixed(2)} • band {chatConfidenceBand}
                  </p>
                  <p className="text-muted-foreground">Plan hash: {chatPlan.planRevisionHash ? chatPlan.planRevisionHash.slice(0, 12) : "missing"}</p>
                  <div className="mt-2 max-h-[150px] space-y-1 overflow-y-auto">
                    {chatPlan.diffGroups.map((group) => (
                      <div key={group.group} className="rounded border px-2 py-1">
                        <p className="font-medium">{group.title}</p>
                        <p className="text-muted-foreground">{group.summary}</p>
                        {group.items.slice(0, 4).map((item) => (
                          <p key={item.id} className="text-muted-foreground">{item.label}</p>
                        ))}
                      </div>
                    ))}
                    {!chatPlan.diffGroups.length ? <p className="text-muted-foreground">No grouped diffs returned.</p> : null}
                  </div>
                  {chatPlan.issues.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-muted-foreground">
                      {chatPlan.issues.map((issue, index) => (
                        <li key={`${issue.code}-${index}`}>[{issue.severity}] {issue.message}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              {chatApplyResult ? (
                <div className="mt-2 rounded border p-2">
                  <p className="font-semibold">
                    {chatApplyResult.suggestionsOnly ? "Suggestions-only (no destructive apply)" : "Applied"}
                  </p>
                  <p className="text-muted-foreground">
                    Revision {chatApplyResult.revisionId ? chatApplyResult.revisionId.slice(0, 8) : "n/a"}
                  </p>
                </div>
              ) : null}
              {chatUndoResult ? (
                <div className="mt-2 rounded border p-2">
                  <p className="font-semibold">Undo restored</p>
                  <p className="text-muted-foreground">Revision {chatUndoResult.appliedRevisionId.slice(0, 8)}</p>
                </div>
              ) : null}
            </div>

            {renderStatus ? (
              <div className="rounded-md border p-2 text-xs">
                <p className="font-semibold">Render {renderStatus.status} ({renderStatus.progress}%)</p>
                <Progress value={renderStatus.progress} />
                {renderStatus.outputUrl ? (
                  <a href={renderStatus.outputUrl} className="mt-1 inline-block underline" target="_blank" rel="noreferrer">
                    Download render
                  </a>
                ) : null}
                {renderStatus.errorMessage ? <p className="text-destructive">{renderStatus.errorMessage}</p> : null}
              </div>
            ) : null}

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Editor health</p>
              <p className="text-muted-foreground">Queue healthy: {health?.queue.healthy ? "yes" : "no"}</p>
              <p className="text-muted-foreground">Render readiness: {health?.render.readiness ?? "unknown"}</p>
              <p className="text-muted-foreground">Queues tracked: {health?.queue.queues.length ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="min-h-[230px]">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Timeline Rail</CardTitle>
              <CardDescription>
                {trackCount} tracks • {clipCount} clips • CapCut-style precision layer
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Zoom {zoomPercent}%</Label>
              <Input
                type="range"
                min={50}
                max={220}
                value={zoomPercent}
                onChange={(event) => setZoomPercent(Number(event.target.value))}
                className="h-8 w-[120px]"
              />
              <Button size="sm" variant="secondary" onClick={() => setTimelineExpanded((previous) => !previous)}>
                {timelineExpanded ? "Collapse" : "Expand"}
              </Button>
            </div>
          </div>
        </CardHeader>
        {timelineExpanded ? (
          <CardContent className="space-y-2 overflow-y-auto">
            <div className="flex items-center justify-between text-xs">
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => setTimelineWindowStart(Math.max(0, timelineWindowStart - timelineWindowSize))}
                  disabled={timelineWindowStart === 0}
                >
                  Prev tracks
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => setTimelineWindowStart(Math.min(Math.max(0, orderedTracks.length - 1), timelineWindowStart + timelineWindowSize))}
                  disabled={timelineWindowStart + timelineWindowSize >= orderedTracks.length}
                >
                  Next tracks
                </Button>
              </div>
              {timelineResult ? (
                <p className="text-muted-foreground">
                  Timeline revision {timelineResult.revision} {timelineResult.revisionId ? `(${timelineResult.revisionId.slice(0, 8)})` : ""}
                </p>
              ) : null}
            </div>

            <div className="max-h-[260px] space-y-2 overflow-y-auto">
              {visibleTracks.map((track) => {
                const collapsed = Boolean(collapsedTracks[track.id]);
                return (
                  <div key={track.id} className={`rounded border p-2 ${track.id === selectedTrackId ? "border-primary" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTrackId(track.id);
                          if (track.clips[0]) {
                            syncSelectedClipDraft(track.id, track.clips[0].id);
                          }
                        }}
                        className="text-left text-xs font-semibold"
                      >
                        {track.name} ({track.kind}) • {track.clips.length} clip(s)
                      </button>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => reorderTrack(track.id, track.order, -1)}>↑</Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => reorderTrack(track.id, track.order, 1)}>↓</Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => toggleTrackCollapsed(track.id)}>
                          {collapsed ? "Expand" : "Collapse"}
                        </Button>
                      </div>
                    </div>
                    {!collapsed ? (
                      <div className="mt-2 overflow-x-auto">
                        <div className="flex min-w-full items-center gap-1">
                          {track.clips.map((clip) => {
                            const durationMs = Math.max(120, clip.timelineOutMs - clip.timelineInMs);
                            const width = Math.max(88, Math.round(durationMs * 0.045 * timelineZoomFactor));
                            const playheadRatio = safeRatio(playheadMs - clip.timelineInMs, durationMs);
                            return (
                              <button
                                key={clip.id}
                                type="button"
                                onClick={() => syncSelectedClipDraft(track.id, clip.id)}
                                className={`relative rounded border px-2 py-1 text-left text-[11px] ${clip.id === selectedClipId ? "border-primary bg-primary/10" : "hover:bg-muted"}`}
                                style={{ width }}
                              >
                                <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-muted">
                                  <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, playheadRatio * 100))}%` }} />
                                </div>
                                <p className="truncate font-medium">{(clip.label ?? "Clip").slice(0, 18)}</p>
                                <p className="text-muted-foreground">{formatMs(clip.timelineInMs)}-{formatMs(clip.timelineOutMs)}</p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!visibleTracks.length ? <p className="text-xs text-muted-foreground">Timeline is empty.</p> : null}
            </div>
          </CardContent>
        ) : null}
      </Card>

      {panelError ? (
        <div className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {panelError}
        </div>
      ) : null}
    </div>
  );
}
