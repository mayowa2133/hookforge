"use client";

import { type ChangeEvent, type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  applyProjectV2ExportProfile,
  applyProjectV2AudioEnhancement,
  applyProjectV2ChatEdit,
  applyProjectV2FillerRemoval,
  createProjectV2ReviewComment,
  createProjectV2ShareLink,
  applyTranscriptRangeDelete,
  applyTranscriptOps,
  autoTranscript,
  batchSetTranscriptSpeaker,
  cancelProjectV2RecordingSession,
  finalizeProjectV2RecordingSession,
  getAiJob,
  getDesktopConfig,
  getProjectV2ChatSessions,
  getProjectV2ExportProfiles,
  getProjectV2PerfHints,
  getProjectV2ReviewComments,
  getProjectV2ShareLinks,
  getProjectV2AudioAnalysis,
  getTranscriptIssues,
  getTranscriptRanges,
  getLegacyProject,
  getProjectV2RevisionGraph,
  getProjectV2RecordingSession,
  getProjectV2EditorHealth,
  getRenderJob,
  getTimeline,
  importProjectV2Media,
  getTranscript,
  patchTimeline,
  planProjectV2ChatEdit,
  postProjectV2RecordingChunk,
  previewProjectV2AudioEnhancement,
  previewProjectV2FillerRemoval,
  previewTranscriptRangeDelete,
  previewTranscriptOps,
  registerProjectV2Media,
  searchTranscript,
  startProjectV2RecordingSession,
  startRender,
  submitProjectV2ReviewDecision,
  trackDesktopEvent,
  trackOpenCutTelemetry,
  updateProjectV2ReviewCommentStatus,
  undoProjectV2AudioEnhancement,
  undoProjectV2ChatEdit,
  type AudioAnalysisPayload,
  type AudioEnhanceResultPayload,
  type AudioEnhancementPreset,
  type AudioFillerResultPayload,
  type ChatApplyResponse,
  type ChatPlanOperationDecision,
  type ChatPlanResponse,
  type ChatSessionSummaryPayload,
  type DesktopConfigPayload,
  type ExportProfilesPayload,
  type EditorHealthStatus,
  type LegacyProjectPayload,
  type ProjectPerfHintsPayload,
  type ProjectReviewCommentsPayload,
  type ProjectShareLinksPayload,
  type RecordingMode,
  type TranscriptIssue,
  type TimelineOperation,
  type RevisionGraphPayload,
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

async function computeSha256Hex(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseEtagFromUploadResponse(response: Response) {
  const raw = response.headers.get("ETag") ?? response.headers.get("etag");
  if (!raw) {
    return null;
  }
  return raw.replaceAll("\"", "").trim();
}

async function notifyIfPermitted(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      return false;
    }
  }
  if (Notification.permission !== "granted") {
    return false;
  }
  new Notification(title, { body });
  return true;
}

async function getCaptureStream(mode: RecordingMode) {
  if (mode === "CAMERA") {
    return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  }
  if (mode === "MIC") {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
  if (mode === "SCREEN") {
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  }
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const combined = new MediaStream([
    ...display.getVideoTracks(),
    ...display.getAudioTracks(),
    ...mic.getAudioTracks()
  ]);
  return combined;
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
  const [transcriptIssues, setTranscriptIssues] = useState<TranscriptIssue[]>([]);
  const [audioAnalysis, setAudioAnalysis] = useState<AudioAnalysisPayload | null>(null);
  const [audioPreset, setAudioPreset] = useState<AudioEnhancementPreset>("dialogue_enhance");
  const [audioTargetLufs, setAudioTargetLufs] = useState("-14");
  const [audioIntensity, setAudioIntensity] = useState("1");
  const [audioPreviewResult, setAudioPreviewResult] = useState<AudioEnhanceResultPayload | null>(null);
  const [audioApplyResult, setAudioApplyResult] = useState<AudioEnhanceResultPayload | null>(null);
  const [audioUndoToken, setAudioUndoToken] = useState<string | null>(null);
  const [audioUndoResult, setAudioUndoResult] = useState<{ restored: boolean; appliedRevisionId: string } | null>(null);
  const [fillerPreviewResult, setFillerPreviewResult] = useState<AudioFillerResultPayload | null>(null);
  const [fillerApplyResult, setFillerApplyResult] = useState<AudioFillerResultPayload | null>(null);
  const [fillerMaxCandidates, setFillerMaxCandidates] = useState("60");
  const [fillerMaxConfidence, setFillerMaxConfidence] = useState("0.92");
  const [speakerBatchFromLabel, setSpeakerBatchFromLabel] = useState("");
  const [speakerBatchToLabel, setSpeakerBatchToLabel] = useState("");
  const [speakerBatchMaxConfidence, setSpeakerBatchMaxConfidence] = useState("0.86");
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
  const [desktopConfig, setDesktopConfig] = useState<DesktopConfigPayload | null>(null);
  const [perfHints, setPerfHints] = useState<ProjectPerfHintsPayload | null>(null);
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
  const [chatOperationDecisions, setChatOperationDecisions] = useState<Record<string, boolean>>({});
  const [chatSessions, setChatSessions] = useState<ChatSessionSummaryPayload["sessions"]>([]);
  const [revisionGraph, setRevisionGraph] = useState<RevisionGraphPayload | null>(null);
  const [shareLinks, setShareLinks] = useState<ProjectShareLinksPayload["shareLinks"]>([]);
  const [shareScope, setShareScope] = useState<"VIEW" | "COMMENT" | "APPROVE">("COMMENT");
  const [shareExpiresDays, setShareExpiresDays] = useState("14");
  const [reviewComments, setReviewComments] = useState<ProjectReviewCommentsPayload["comments"]>([]);
  const [reviewCommentBody, setReviewCommentBody] = useState("");
  const [reviewCommentStatusFilter, setReviewCommentStatusFilter] = useState<"ALL" | "OPEN" | "RESOLVED">("ALL");
  const [reviewDecisionNote, setReviewDecisionNote] = useState("");
  const [reviewApprovalRequired, setReviewApprovalRequired] = useState(true);
  const [reviewLatestDecision, setReviewLatestDecision] = useState<{
    id: string;
    status: "APPROVED" | "REJECTED";
    createdAt: string;
    revisionId: string | null;
  } | null>(null);
  const [exportProfiles, setExportProfiles] = useState<ExportProfilesPayload["exportProfiles"]>([]);
  const [selectedExportProfileId, setSelectedExportProfileId] = useState("");
  const [newExportProfileName, setNewExportProfileName] = useState("Social 9x16");
  const [newExportProfileResolution, setNewExportProfileResolution] = useState("1080x1920");
  const [newExportProfileFps, setNewExportProfileFps] = useState("30");
  const [importUploading, setImportUploading] = useState(false);
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("SCREEN_CAMERA");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);
  const [recordingSessionId, setRecordingSessionId] = useState<string | null>(null);
  const [recordingUploadProgress, setRecordingUploadProgress] = useState(0);
  const [recordingStatusLabel, setRecordingStatusLabel] = useState<string>("Idle");
  const [recordingBusy, setRecordingBusy] = useState(false);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);
  const openedTelemetryRef = useRef(false);
  const bootTrackedRef = useRef(false);
  const bootStartedAtRef = useRef<number>(
    typeof performance !== "undefined" ? performance.now() : Date.now()
  );
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchParams = useSearchParams();
  const shareToken = useMemo(() => searchParams.get("shareToken")?.trim() || undefined, [searchParams]);

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
  const segmentWindowSize = perfHints?.suggested.segmentWindowSize ?? 220;
  const timelineWindowSize = perfHints?.suggested.timelineWindowSize ?? 60;
  const totalSegments = transcript?.segments.length ?? 0;

  const visibleSegments = useMemo(
    () => transcript?.segments.slice(segmentWindowStart, segmentWindowStart + segmentWindowSize) ?? [],
    [segmentWindowSize, segmentWindowStart, transcript?.segments]
  );

  const visibleTracks = useMemo(
    () => orderedTracks.slice(timelineWindowStart, timelineWindowStart + timelineWindowSize),
    [orderedTracks, timelineWindowSize, timelineWindowStart]
  );

  const filteredReviewComments = useMemo(() => {
    if (reviewCommentStatusFilter === "ALL") {
      return reviewComments;
    }
    return reviewComments.filter((comment) => comment.status === reviewCommentStatusFilter);
  }, [reviewCommentStatusFilter, reviewComments]);

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
    const [next, issuesPayload] = await Promise.all([
      getTranscript(projectV2Id, language),
      getTranscriptIssues(projectV2Id, language, minConfidenceForRipple)
    ]);
    setTranscript(next);
    setTranscriptIssues(issuesPayload.issues);
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
  }, [language, minConfidenceForRipple, projectV2Id, selectedSegmentId]);

  const loadAudioAnalysis = useCallback(async () => {
    const maxCandidates = Math.max(1, Math.floor(Number(fillerMaxCandidates) || 60));
    const parsedConfidence = Number(fillerMaxConfidence);
    const maxConfidence = Number.isFinite(parsedConfidence) ? Math.max(0, Math.min(1, parsedConfidence)) : 0.92;
    const payload = await getProjectV2AudioAnalysis(
      projectV2Id,
      language,
      maxCandidates,
      maxConfidence
    );
    setAudioAnalysis(payload);
  }, [fillerMaxCandidates, fillerMaxConfidence, language, projectV2Id]);

  const loadChatDiagnostics = useCallback(async () => {
    const [sessionsPayload, graphPayload] = await Promise.all([
      getProjectV2ChatSessions(projectV2Id, 20),
      getProjectV2RevisionGraph(projectV2Id, 160)
    ]);
    setChatSessions(sessionsPayload.sessions);
    setRevisionGraph(graphPayload);
  }, [projectV2Id]);

  const loadDesktopPerf = useCallback(async () => {
    const [configPayload, perfPayload] = await Promise.all([
      getDesktopConfig(),
      getProjectV2PerfHints(projectV2Id)
    ]);
    setDesktopConfig(configPayload);
    setPerfHints(perfPayload);
  }, [projectV2Id]);

  const loadReviewPublishing = useCallback(async () => {
    const [sharePayload, commentsPayload, exportPayload] = await Promise.allSettled([
      getProjectV2ShareLinks(projectV2Id),
      getProjectV2ReviewComments(projectV2Id, shareToken),
      getProjectV2ExportProfiles(projectV2Id)
    ]);
    const shareLinksPayload = sharePayload.status === "fulfilled" ? sharePayload.value : { shareLinks: [] };
    const reviewCommentsPayload = commentsPayload.status === "fulfilled" ? commentsPayload.value : { comments: [] };
    const exportProfilesPayload = exportPayload.status === "fulfilled" ? exportPayload.value : { exportProfiles: [] };

    setShareLinks(shareLinksPayload.shareLinks);
    setReviewComments(reviewCommentsPayload.comments);
    if ("reviewGate" in reviewCommentsPayload) {
      setReviewApprovalRequired(reviewCommentsPayload.reviewGate.approvalRequired);
      setReviewLatestDecision(reviewCommentsPayload.reviewGate.latestDecision);
    }
    setExportProfiles(exportProfilesPayload.exportProfiles);
    setSelectedExportProfileId((previous) => {
      if (previous && exportProfilesPayload.exportProfiles.some((profile) => profile.id === previous)) {
        return previous;
      }
      return exportProfilesPayload.exportProfiles.find((profile) => profile.isDefault)?.id ?? exportProfilesPayload.exportProfiles[0]?.id ?? "";
    });
  }, [projectV2Id, shareToken]);

  useEffect(() => {
    let canceled = false;
    const load = async () => {
      try {
        setPanelError(null);
        await Promise.all([loadProjectSurface(), loadTranscript(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
        if (!bootTrackedRef.current) {
          bootTrackedRef.current = true;
          const bootMs = Math.max(
            0,
            Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - bootStartedAtRef.current)
          );
          void trackDesktopEvent({
            projectId: projectV2Id,
            event: "editor_boot",
            outcome: "SUCCESS",
            durationMs: bootMs,
            metadata: {
              shell: "opencut",
              entrypoint: "projects-v2"
            }
          }).catch(() => {});
        }
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
  }, [loadAudioAnalysis, loadChatDiagnostics, loadDesktopPerf, loadProjectSurface, loadReviewPublishing, loadTranscript, projectV2Id]);

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
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    const requestRecording = searchParams.get("recording");
    if (requestRecording === "1") {
      setRecordingStatusLabel("Ready to record. Choose mode and click Start Recording.");
    }
  }, [searchParams]);

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
          await Promise.all([loadTranscript(), loadProjectSurface(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
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
  }, [appendHistory, autoJobId, loadAudioAnalysis, loadChatDiagnostics, loadDesktopPerf, loadProjectSurface, loadReviewPublishing, loadTranscript]);

  useEffect(() => {
    if (!renderJobId) {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const payload = await getRenderJob(renderJobId);
        setRenderStatus(payload.renderJob);
        if (payload.renderJob.status === "DONE") {
          await Promise.all([loadProjectSurface(), loadDesktopPerf()]);
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
          const notified = await notifyIfPermitted("HookForge render complete", `Render ${payload.renderJob.id.slice(0, 8)} finished.`);
          if (notified) {
            void trackDesktopEvent({
              projectId: projectV2Id,
              event: "background_render_notice",
              outcome: "INFO",
              metadata: {
                renderJobId: payload.renderJob.id
              }
            }).catch(() => {});
          }
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
  }, [appendHistory, loadDesktopPerf, loadProjectSurface, projectV2Id, renderJobId]);

  useEffect(() => {
    if (!recordingSessionId) {
      return;
    }
    const interval = setInterval(async () => {
      try {
        const payload = await getProjectV2RecordingSession(projectV2Id, recordingSessionId);
        setRecordingUploadProgress(payload.progress.progressPct);
        setRecordingStatusLabel(`Session ${payload.session.status.toLowerCase()} (${payload.progress.completedParts}/${payload.progress.totalParts})`);
      } catch {
        // ignore transient status poll errors
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [projectV2Id, recordingSessionId]);

  const timelineSelectionContext = useMemo(() => ({
    selectedTrackId: selectedTrackId || null,
    selectedClipId: selectedClipId || null,
    selectedSegmentId: selectedSegmentId || null,
    playheadMs,
    language
  }), [language, playheadMs, selectedClipId, selectedSegmentId, selectedTrackId]);

  const applyTimelineOperations = useCallback(async (operations: TimelineOperation[], action: string, uiIntent: TimelineOperation["uiIntent"] = "manual_edit") => {
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let outcome: "SUCCESS" | "ERROR" = "SUCCESS";
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
      await Promise.all([loadTranscript(), loadProjectSurface(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Timeline edit",
        detail: `${action} applied (rev ${payload.revision})`,
        status: "SUCCESS"
      });
    } catch (error) {
      outcome = "ERROR";
      const message = error instanceof Error ? error.message : "Timeline operation failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Timeline edit",
        detail: `${action} failed: ${message}`,
        status: "ERROR"
      });
    } finally {
      const durationMs = Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt)
      );
      void trackDesktopEvent({
        projectId: projectV2Id,
        event: "command_latency",
        outcome,
        durationMs,
        metadata: {
          command: action,
          target: "timeline",
          operationCount: operations.length,
          uiIntent
        }
      }).catch(() => {});
      setBusy(null);
    }
  }, [appendHistory, loadAudioAnalysis, loadChatDiagnostics, loadDesktopPerf, loadProjectSurface, loadReviewPublishing, loadTranscript, projectV2Id, timelineSelectionContext]);

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
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let outcome: "SUCCESS" | "ERROR" = "SUCCESS";
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
      await Promise.all([loadTranscript(), loadProjectSurface(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
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
      outcome = "ERROR";
      const message = error instanceof Error ? error.message : "Transcript operation failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Transcript apply",
        detail: `${action} failed: ${message}`,
        status: "ERROR"
      });
    } finally {
      const durationMs = Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt)
      );
      void trackDesktopEvent({
        projectId: projectV2Id,
        event: "command_latency",
        outcome,
        durationMs,
        metadata: {
          command: action,
          target: "transcript",
          operationCount: operations.length
        }
      }).catch(() => {});
      setBusy(null);
    }
  }, [appendHistory, language, loadAudioAnalysis, loadChatDiagnostics, loadDesktopPerf, loadProjectSurface, loadReviewPublishing, loadTranscript, minConfidenceForRipple, projectV2Id]);

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
    if (!chatPlan) {
      return "N/A";
    }
    if (chatPlan.safetyMode === "SUGGESTIONS_ONLY") {
      return "Suggestions-only";
    }
    if (chatPlan.safetyMode === "APPLY_WITH_CONFIRM") {
      return "Apply-with-confirm";
    }
    return "Applied";
  }, [chatPlan]);

  const selectedChatOperationCount = useMemo(
    () => Object.values(chatOperationDecisions).filter(Boolean).length,
    [chatOperationDecisions]
  );

  const totalSelectableChatOperations = useMemo(
    () => Object.keys(chatOperationDecisions).length,
    [chatOperationDecisions]
  );

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

  const lowConfidenceIssues = useMemo(
    () => transcriptIssues.filter((issue) => issue.type === "LOW_CONFIDENCE"),
    [transcriptIssues]
  );

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

  const importLocalMediaFile = useCallback(async (file: File, source: "drop" | "picker") => {
    if (!file) {
      return;
    }
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    setImportUploading(true);
    setBusy("media_import");
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const slot = file.type.startsWith("audio/") ? "audio" : "primary";
      const importPayload = await importProjectV2Media(projectV2Id, {
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        slot
      });
      const uploadResponse = await fetch(importPayload.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream"
        },
        body: file
      });
      if (!uploadResponse.ok) {
        throw new Error(`Media upload failed (${uploadResponse.status})`);
      }
      await registerProjectV2Media(projectV2Id, {
        storageKey: importPayload.storageKey,
        mimeType: file.type || "application/octet-stream",
        originalFileName: file.name,
        slot
      });

      if (!file.type.startsWith("image/")) {
        const transcriptJob = await autoTranscript(projectV2Id, {
          language,
          diarization: false,
          punctuationStyle: "auto",
          confidenceThreshold: minConfidenceForRipple,
          reDecodeEnabled: true,
          maxWordsPerSegment: 7,
          maxCharsPerLine: 24,
          maxLinesPerSegment: 2
        });
        setAutoJobId(transcriptJob.aiJobId);
        setAutoJobStatus({ status: transcriptJob.status, progress: 0 });
      }

      await Promise.all([loadProjectSurface(), loadTranscript(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Media import",
        detail: `${file.name} uploaded (${source})`,
        status: "SUCCESS"
      });

      const durationMs = Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt)
      );
      void trackDesktopEvent({
        projectId: projectV2Id,
        event: source === "drop" ? "drop_import" : "desktop_menu_action",
        outcome: "SUCCESS",
        durationMs,
        metadata: {
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          source
        }
      }).catch(() => {});
      const notified = await notifyIfPermitted("HookForge upload complete", `${file.name} is ready in your project.`);
      if (notified) {
        void trackDesktopEvent({
          projectId: projectV2Id,
          event: "background_upload_notice",
          outcome: "INFO",
          metadata: {
            fileName: file.name
          }
        }).catch(() => {});
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Media import failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Media import",
        detail: message,
        status: "ERROR"
      });
      void trackDesktopEvent({
        projectId: projectV2Id,
        event: source === "drop" ? "drop_import" : "desktop_menu_action",
        outcome: "ERROR",
        metadata: {
          fileName: file.name
        }
      }).catch(() => {});
    } finally {
      setBusy(null);
      setImportUploading(false);
    }
  }, [
    language,
    loadAudioAnalysis,
    loadChatDiagnostics,
    loadDesktopPerf,
    loadProjectSurface,
    loadReviewPublishing,
    loadTranscript,
    minConfidenceForRipple,
    projectV2Id
  ]);

  const uploadRecordingWithSinglePutFallback = useCallback(async (blob: Blob, fileName: string, mimeType: string) => {
    setRecordingStatusLabel("Fallback upload (single PUT)...");
    const importPayload = await importProjectV2Media(projectV2Id, {
      fileName,
      mimeType,
      sizeBytes: blob.size,
      slot: mimeType.startsWith("audio/") ? "audio" : "primary"
    });
    const uploadResponse = await fetch(importPayload.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType
      },
      body: blob
    });
    if (!uploadResponse.ok) {
      throw new Error(`Fallback upload failed (${uploadResponse.status})`);
    }
    const registerPayload = await registerProjectV2Media(projectV2Id, {
      storageKey: importPayload.storageKey,
      mimeType,
      originalFileName: fileName,
      slot: mimeType.startsWith("audio/") ? "audio" : "primary"
    });
    if (!mimeType.startsWith("image/")) {
      const transcriptJob = await autoTranscript(projectV2Id, {
        language,
        diarization: false,
        punctuationStyle: "auto",
        confidenceThreshold: minConfidenceForRipple,
        reDecodeEnabled: true,
        maxWordsPerSegment: 7,
        maxCharsPerLine: 24,
        maxLinesPerSegment: 2
      });
      setAutoJobId(transcriptJob.aiJobId);
      setAutoJobStatus({ status: transcriptJob.status, progress: 0 });
    }
    return registerPayload;
  }, [language, minConfidenceForRipple, projectV2Id]);

  const uploadRecordingBlob = useCallback(async (blob: Blob, mode: RecordingMode) => {
    const mimeType = blob.type || (mode === "MIC" ? "audio/webm" : "video/webm");
    const extension = mode === "MIC" ? "webm" : "webm";
    const fileName = `recording-${new Date().toISOString().replaceAll(":", "-")}.${extension}`;
    const partSizeBytes = 8 * 1024 * 1024;
    const totalParts = Math.max(1, Math.ceil(blob.size / partSizeBytes));

    setRecordingBusy(true);
    setRecordingUploadProgress(0);
    setRecordingStatusLabel("Creating recording session...");

    try {
      const started = await startProjectV2RecordingSession(projectV2Id, {
        mode,
        fileName,
        mimeType,
        sizeBytes: blob.size,
        totalParts,
        partSizeBytes,
        autoTranscribe: true,
        language
      });
      setRecordingSessionId(started.session.id);

      let shouldFallbackToSinglePut = false;
      for (let index = 0; index < totalParts; index += 1) {
        const partNumber = index + 1;
        const begin = index * partSizeBytes;
        const end = Math.min(blob.size, begin + partSizeBytes);
        const chunk = blob.slice(begin, end);
        setRecordingStatusLabel(`Uploading chunk ${partNumber}/${totalParts}...`);
        const uploadIntent = await postProjectV2RecordingChunk(projectV2Id, started.session.id, { partNumber });
        if (uploadIntent.mode !== "UPLOAD_URL") {
          throw new Error("Unexpected chunk response mode");
        }
        const uploadResponse = await fetch(uploadIntent.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": mimeType
          },
          body: chunk
        });
        if (!uploadResponse.ok) {
          throw new Error(`Chunk upload failed (${uploadResponse.status})`);
        }

        const eTag = parseEtagFromUploadResponse(uploadResponse);
        if (!eTag) {
          shouldFallbackToSinglePut = true;
          break;
        }

        const checksumSha256 = await computeSha256Hex(chunk);
        const chunkResult = await postProjectV2RecordingChunk(projectV2Id, started.session.id, {
          partNumber,
          eTag,
          checksumSha256
        });
        if (chunkResult.mode === "CHUNK_CONFIRMED") {
          setRecordingUploadProgress(chunkResult.progress.progressPct);
        }
      }

      if (shouldFallbackToSinglePut) {
        await cancelProjectV2RecordingSession(projectV2Id, started.session.id);
        setRecordingStatusLabel("Multipart not available in browser, using fallback...");
        await uploadRecordingWithSinglePutFallback(blob, fileName, mimeType);
        setRecordingSessionId(null);
        setRecordingUploadProgress(100);
        setRecordingStatusLabel("Recording uploaded (fallback)");
        appendHistory({
          label: "Recording upload",
          detail: "Uploaded using fallback single PUT path",
          status: "INFO"
        });
        await Promise.all([loadProjectSurface(), loadAudioAnalysis(), loadChatDiagnostics()]);
        return;
      }

      setRecordingStatusLabel("Finalizing recording...");
      const finalized = await finalizeProjectV2RecordingSession(projectV2Id, started.session.id, {
        autoTranscribe: true,
        language
      });
      setRecordingUploadProgress(100);
      setRecordingStatusLabel(finalized.status === "COMPLETED" ? "Recording finalized" : `Recording ${finalized.status.toLowerCase()}`);
      if (finalized.aiJobId) {
        setAutoJobId(finalized.aiJobId);
        setAutoJobStatus({ status: "QUEUED", progress: 0 });
      }
      await Promise.all([loadProjectSurface(), loadTranscript(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
      appendHistory({
        label: "Recording finalized",
        detail: finalized.aiJobId ? "Recording uploaded and transcription queued" : "Recording uploaded",
        status: "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recording upload failed";
      setPanelError(message);
      setRecordingStatusLabel("Recording failed");
      appendHistory({
        label: "Recording error",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setRecordingBusy(false);
    }
  }, [appendHistory, language, loadAudioAnalysis, loadChatDiagnostics, loadProjectSurface, loadTranscript, projectV2Id, uploadRecordingWithSinglePutFallback]);

  const startCaptureRecording = useCallback(async () => {
    if (isRecording || recordingBusy) {
      return;
    }
    if (typeof window === "undefined" || !("MediaRecorder" in window)) {
      setPanelError("MediaRecorder is not supported in this browser.");
      return;
    }
    try {
      const stream = await getCaptureStream(recordingMode);
      const preferredMime =
        recordingMode === "MIC"
          ? "audio/webm;codecs=opus"
          : "video/webm;codecs=vp8,opus";
      const mimeType = MediaRecorder.isTypeSupported(preferredMime)
        ? preferredMime
        : recordingMode === "MIC"
          ? "audio/webm"
          : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recordingStreamRef.current = stream;
      recordedChunksRef.current = [];
      setRecordingElapsedSec(0);
      setRecordingStatusLabel(`Recording ${recordingMode.toLowerCase().replaceAll("_", "+")}...`);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        if (recordingStreamRef.current) {
          recordingStreamRef.current.getTracks().forEach((track) => track.stop());
          recordingStreamRef.current = null;
        }
        setIsRecording(false);
        if (!chunks.length) {
          setRecordingStatusLabel("Recording stopped (no data)");
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || (recordingMode === "MIC" ? "audio/webm" : "video/webm") });
        await uploadRecordingBlob(blob, recordingMode);
      };
      recorder.start(1200);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => {
        setRecordingElapsedSec((previous) => previous + 1);
      }, 1000);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Unable to start recording");
      setRecordingStatusLabel("Recording unavailable");
    }
  }, [isRecording, recordingBusy, recordingMode, uploadRecordingBlob]);

  const stopCaptureRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }
    recorder.stop();
  }, []);

  const handleLocalFilePick = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    await importLocalMediaFile(file, "picker");
    event.target.value = "";
  }, [importLocalMediaFile]);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropzoneActive(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropzoneActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
      setDropzoneActive(false);
    }
  }, []);

  const handleDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropzoneActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }
    await importLocalMediaFile(file, "drop");
  }, [importLocalMediaFile]);

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

  const previewAudioEnhancement = async () => {
    setBusy("audio_enhance_preview");
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const targetLufs = Number(audioTargetLufs);
      const intensity = Number(audioIntensity);
      const payload = await previewProjectV2AudioEnhancement(projectV2Id, {
        language,
        preset: audioPreset,
        targetLufs: Number.isFinite(targetLufs) ? targetLufs : -14,
        intensity: Number.isFinite(intensity) ? intensity : 1
      });
      setAudioPreviewResult(payload);
      setAudioApplyResult(null);
      setAudioUndoResult(null);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Audio preview",
        detail: `${payload.preset} preview generated (${payload.timelineOps.length} ops)`,
        status: "INFO"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Audio preview failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Audio preview",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const applyAudioEnhancement = async () => {
    setBusy("audio_enhance_apply");
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const targetLufs = Number(audioTargetLufs);
      const intensity = Number(audioIntensity);
      const payload = await applyProjectV2AudioEnhancement(projectV2Id, {
        language,
        preset: audioPreset,
        targetLufs: Number.isFinite(targetLufs) ? targetLufs : -14,
        intensity: Number.isFinite(intensity) ? intensity : 1
      });
      setAudioApplyResult(payload);
      setAudioUndoToken(payload.undoToken);
      setAudioUndoResult(null);
      await Promise.all([loadProjectSurface(), loadTranscript(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Audio apply",
        detail: payload.suggestionsOnly
          ? `Suggestions-only (${payload.issues.length} issues)`
          : `Applied ${payload.preset} (rev ${payload.revisionId?.slice(0, 8) ?? "n/a"})`,
        status: payload.suggestionsOnly ? "INFO" : "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Audio apply failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Audio apply",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const undoAudioEnhancement = async () => {
    if (!audioUndoToken) {
      return;
    }
    setBusy("audio_enhance_undo");
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const payload = await undoProjectV2AudioEnhancement(projectV2Id, audioUndoToken);
      setAudioUndoResult(payload);
      setAudioUndoToken(null);
      await Promise.all([loadProjectSurface(), loadTranscript(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Audio undo",
        detail: `Restored revision ${payload.appliedRevisionId.slice(0, 8)}`,
        status: "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Audio undo failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Audio undo",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const previewFillerRemoval = async () => {
    setBusy("audio_filler_preview");
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const maxCandidates = Math.max(1, Math.floor(Number(fillerMaxCandidates) || 60));
      const maxConfidence = Number(fillerMaxConfidence);
      const payload = await previewProjectV2FillerRemoval(projectV2Id, {
        language,
        maxCandidates,
        maxConfidence: Number.isFinite(maxConfidence) ? Math.max(0, Math.min(1, maxConfidence)) : 0.92,
        minConfidenceForRipple
      });
      setFillerPreviewResult(payload);
      setFillerApplyResult(null);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Filler preview",
        detail: `Detected ${payload.candidateCount} candidate(s)`,
        status: "INFO"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Filler preview failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Filler preview",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const applyFillerRemoval = async () => {
    setBusy("audio_filler_apply");
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const maxCandidates = Math.max(1, Math.floor(Number(fillerMaxCandidates) || 60));
      const maxConfidence = Number(fillerMaxConfidence);
      const payload = await applyProjectV2FillerRemoval(projectV2Id, {
        language,
        maxCandidates,
        maxConfidence: Number.isFinite(maxConfidence) ? Math.max(0, Math.min(1, maxConfidence)) : 0.92,
        minConfidenceForRipple
      });
      setFillerApplyResult(payload);
      await Promise.all([loadProjectSurface(), loadTranscript(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Filler apply",
        detail: payload.suggestionsOnly
          ? `Suggestions-only (${payload.issues.length} issue(s))`
          : `Applied ${payload.candidateCount} filler deletion(s)`,
        status: payload.suggestionsOnly ? "INFO" : "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Filler apply failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Filler apply",
        detail: message,
        status: "ERROR"
      });
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

  const applySpeakerBatch = async () => {
    setBusy("set_speaker_batch");
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const maxConfidence = Number(speakerBatchMaxConfidence);
      const payload = await batchSetTranscriptSpeaker(projectV2Id, {
        language,
        fromSpeakerLabel: speakerBatchFromLabel.trim() || undefined,
        speakerLabel: speakerBatchToLabel.trim() || null,
        maxConfidence: Number.isFinite(maxConfidence) ? Math.max(0, Math.min(1, maxConfidence)) : undefined,
        minConfidenceForRipple
      });
      setLastTranscriptPreview(payload);
      await Promise.all([loadTranscript(), loadProjectSurface(), loadAudioAnalysis()]);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Speaker batch",
        detail: `Updated ${payload.affectedSegments} segment(s)`,
        status: payload.suggestionsOnly ? "INFO" : "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Speaker batch update failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Speaker batch",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const previewRangeDelete = async () => {
    if (!transcript || transcript.words.length === 0) {
      return;
    }
    setBusy("delete_range_preview");
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const payload = await previewTranscriptRangeDelete(projectV2Id, {
        language,
        selection: rangeSelection,
        minConfidenceForRipple
      });
      setLastTranscriptPreview(payload);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Transcript preview",
        detail: `Word-range preview ${payload.selection.startWordIndex}-${payload.selection.endWordIndex}`,
        status: "INFO"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Range preview failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Transcript preview",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const applyRangeDelete = async () => {
    if (!transcript || transcript.words.length === 0) {
      return;
    }
    setBusy("delete_range_apply");
    setPanelError(null);
    setAutosaveStatus("SAVING");
    try {
      const payload = await applyTranscriptRangeDelete(projectV2Id, {
        language,
        selection: rangeSelection,
        minConfidenceForRipple
      });
      setLastTranscriptPreview(payload);
      await Promise.all([loadTranscript(), loadProjectSurface(), loadAudioAnalysis()]);
      setAutosaveStatus("SAVED");
      appendHistory({
        label: "Transcript apply",
        detail: `Word-range apply ${payload.selection.startWordIndex}-${payload.selection.endWordIndex} (${payload.suggestionsOnly ? "suggestions only" : "applied"})`,
        status: payload.suggestionsOnly ? "INFO" : "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Range apply failed";
      setPanelError(message);
      setAutosaveStatus("ERROR");
      appendHistory({
        label: "Transcript apply",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
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

  const syncRangeFromSelectedSegment = async () => {
    if (!selectedSegment || !transcript) {
      return;
    }
    const segmentIndex = transcript.segments.findIndex((segment) => segment.id === selectedSegment.id);
    if (segmentIndex < 0) {
      return;
    }
    try {
      const payload = await getTranscriptRanges(projectV2Id, language, segmentIndex, 1);
      const range = payload.ranges[0];
      if (!range || range.startWordIndex < 0 || range.endWordIndex < 0) {
        return;
      }
      setRangeSelection({
        startWordIndex: range.startWordIndex,
        endWordIndex: range.endWordIndex
      });
    } catch {
      // noop, this sync utility should not interrupt editing flow
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
      const defaults: Record<string, boolean> = {};
      for (const group of plan.diffGroups) {
        for (const item of group.items) {
          if (item.type === "operation" && typeof item.operationIndex === "number") {
            defaults[item.id] = true;
          }
        }
      }
      setChatOperationDecisions(defaults);
      await loadChatDiagnostics();
      appendHistory({
        label: "Chat plan",
        detail: `Plan generated (${plan.safetyMode}, confidence ${plan.confidence.toFixed(2)})`,
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

  const toggleChatOperationDecision = (itemId: string) => {
    setChatOperationDecisions((previous) => ({
      ...previous,
      [itemId]: !previous[itemId]
    }));
  };

  const applyChatPlan = async () => {
    if (!chatPlan || !chatPlan.planRevisionHash) {
      return;
    }
    const operationDecisions: ChatPlanOperationDecision[] = Object.entries(chatOperationDecisions).map(([itemId, accepted]) => ({
      itemId,
      accepted
    }));
    const selectedCount = operationDecisions.filter((decision) => decision.accepted).length;
    if (chatPlan.executionMode === "APPLIED" && selectedCount === 0) {
      setPanelError("Select at least one planned operation before apply.");
      return;
    }
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    let outcome: "SUCCESS" | "ERROR" = "SUCCESS";
    setBusy("chat_apply");
    setPanelError(null);
    try {
      const result = await applyProjectV2ChatEdit(projectV2Id, {
        planId: chatPlan.planId,
        planRevisionHash: chatPlan.planRevisionHash,
        confirmed: true,
        operationDecisions
      });
      setChatApplyResult(result);
      setChatUndoToken(result.undoToken);
      await Promise.all([loadProjectSurface(), loadTranscript(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
      appendHistory({
        label: "Chat apply",
        detail: result.suggestionsOnly
          ? "Suggestions-only path; no destructive apply"
          : `Plan applied (${result.selectedOperationCount ?? selectedCount}/${result.totalOperationCount ?? selectedCount} ops)`,
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
      outcome = "ERROR";
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
      const durationMs = Math.max(
        0,
        Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt)
      );
      void trackDesktopEvent({
        projectId: projectV2Id,
        event: "command_latency",
        outcome,
        durationMs,
        metadata: {
          command: "chat_apply",
          selectedCount,
          totalCount: operationDecisions.length
        }
      }).catch(() => {});
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
      await Promise.all([loadProjectSurface(), loadTranscript(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()]);
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

  const createShareLink = async () => {
    setBusy("share_link_create");
    setPanelError(null);
    try {
      const expiresInDaysRaw = Number(shareExpiresDays);
      const expiresInDays = Number.isFinite(expiresInDaysRaw) ? Math.max(1, Math.min(365, Math.floor(expiresInDaysRaw))) : undefined;
      await createProjectV2ShareLink(projectV2Id, {
        scope: shareScope,
        expiresInDays
      });
      await loadReviewPublishing();
      appendHistory({
        label: "Share link",
        detail: `Created ${shareScope.toLowerCase()} link`,
        status: "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create share link";
      setPanelError(message);
      appendHistory({
        label: "Share link",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const addReviewComment = async () => {
    const body = reviewCommentBody.trim();
    if (!body) {
      return;
    }
    setBusy("review_comment_create");
    setPanelError(null);
    try {
      await createProjectV2ReviewComment(projectV2Id, {
        shareToken,
        body,
        anchorMs: playheadMs,
        transcriptStartMs: selectedSegment?.startMs ?? null,
        transcriptEndMs: selectedSegment?.endMs ?? null,
        timelineTrackId: selectedTrack?.id ?? null,
        clipId: selectedClip?.id ?? null
      });
      setReviewCommentBody("");
      await loadReviewPublishing();
      appendHistory({
        label: "Review comment",
        detail: "Comment added",
        status: "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add review comment";
      setPanelError(message);
      appendHistory({
        label: "Review comment",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const updateReviewComment = async (commentId: string, statusValue: "OPEN" | "RESOLVED") => {
    setBusy("review_comment_update");
    setPanelError(null);
    try {
      await updateProjectV2ReviewCommentStatus(projectV2Id, commentId, {
        shareToken,
        status: statusValue
      });
      await loadReviewPublishing();
      appendHistory({
        label: "Review comment",
        detail: `Marked ${statusValue.toLowerCase()}`,
        status: "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update review comment";
      setPanelError(message);
      appendHistory({
        label: "Review comment",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const submitReviewDecision = async (decision: "APPROVED" | "REJECTED") => {
    setBusy("review_decision_submit");
    setPanelError(null);
    try {
      const payload = await submitProjectV2ReviewDecision(projectV2Id, {
        shareToken,
        status: decision,
        note: reviewDecisionNote.trim() || undefined,
        requireApproval: reviewApprovalRequired
      });
      setReviewLatestDecision({
        id: payload.decision.id,
        status: payload.decision.status,
        createdAt: payload.decision.createdAt,
        revisionId: payload.decision.revisionId
      });
      await loadReviewPublishing();
      appendHistory({
        label: "Review decision",
        detail: `${decision.toLowerCase()} submitted`,
        status: decision === "APPROVED" ? "SUCCESS" : "INFO"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to submit review decision";
      setPanelError(message);
      appendHistory({
        label: "Review decision",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const applyExistingExportProfile = async () => {
    if (!selectedExportProfileId) {
      return;
    }
    setBusy("export_profile_apply");
    setPanelError(null);
    try {
      await applyProjectV2ExportProfile(projectV2Id, {
        profileId: selectedExportProfileId
      });
      await Promise.all([loadProjectSurface(), loadReviewPublishing()]);
      appendHistory({
        label: "Export profile",
        detail: "Applied export profile",
        status: "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply export profile";
      setPanelError(message);
      appendHistory({
        label: "Export profile",
        detail: message,
        status: "ERROR"
      });
    } finally {
      setBusy(null);
    }
  };

  const createAndApplyExportProfile = async () => {
    const name = newExportProfileName.trim();
    if (!name) {
      return;
    }
    setBusy("export_profile_create");
    setPanelError(null);
    try {
      const fpsValue = Number(newExportProfileFps);
      const response = await applyProjectV2ExportProfile(projectV2Id, {
        createProfile: {
          name,
          resolution: newExportProfileResolution.trim() || "1080x1920",
          fps: Number.isFinite(fpsValue) ? Math.max(12, Math.min(120, Math.floor(fpsValue))) : 30,
          container: "mp4",
          isDefault: false
        }
      });
      setExportProfiles(response.exportProfiles.map((profile) => ({
        ...profile,
        config: null
      })));
      setSelectedExportProfileId(response.profile.id);
      await loadProjectSurface();
      appendHistory({
        label: "Export profile",
        detail: `Created ${response.profile.name}`,
        status: "SUCCESS"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create export profile";
      setPanelError(message);
      appendHistory({
        label: "Export profile",
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
    <div
      className="relative flex h-[calc(100vh-120px)] min-h-[720px] flex-col gap-3"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropzoneActive ? (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85">
          <p className="rounded-md border bg-background px-3 py-2 text-sm font-semibold text-foreground">
            Drop media to import into the project
          </p>
        </div>
      ) : null}
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
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void Promise.all([loadProjectSurface(), loadTranscript(), loadAudioAnalysis(), loadChatDiagnostics(), loadReviewPublishing(), loadDesktopPerf()])}
                  disabled={busy !== null}
                >
                  Refresh Project State
                </Button>
                <Button size="sm" variant="outline" onClick={enqueueRender} disabled={busy !== null || health?.render.readiness === "BLOCKED"}>
                  Render MP4
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => localFileInputRef.current?.click()}
                  disabled={busy !== null || importUploading}
                >
                  {importUploading ? "Uploading..." : "Import Local Media"}
                </Button>
                <input
                  ref={localFileInputRef}
                  type="file"
                  accept="video/*,audio/*,image/*"
                  className="hidden"
                  onChange={handleLocalFilePick}
                />
              </div>
              {autoJobStatus ? (
                <div className="mt-2">
                  <p className="text-muted-foreground">ASR job {autoJobStatus.status} ({autoJobStatus.progress}%)</p>
                  <Progress value={autoJobStatus.progress} />
                </div>
              ) : null}
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Recording Studio</p>
              <p className="text-muted-foreground">Record in browser -&gt; chunk upload -&gt; auto transcript.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant={recordingMode === "SCREEN" ? "secondary" : "outline"}
                  disabled={isRecording || recordingBusy}
                  onClick={() => setRecordingMode("SCREEN")}
                >
                  Screen
                </Button>
                <Button
                  size="sm"
                  variant={recordingMode === "CAMERA" ? "secondary" : "outline"}
                  disabled={isRecording || recordingBusy}
                  onClick={() => setRecordingMode("CAMERA")}
                >
                  Camera
                </Button>
                <Button
                  size="sm"
                  variant={recordingMode === "MIC" ? "secondary" : "outline"}
                  disabled={isRecording || recordingBusy}
                  onClick={() => setRecordingMode("MIC")}
                >
                  Mic
                </Button>
                <Button
                  size="sm"
                  variant={recordingMode === "SCREEN_CAMERA" ? "secondary" : "outline"}
                  disabled={isRecording || recordingBusy}
                  onClick={() => setRecordingMode("SCREEN_CAMERA")}
                >
                  Screen+Cam
                </Button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button size="sm" onClick={startCaptureRecording} disabled={isRecording || recordingBusy}>
                  Start Recording
                </Button>
                <Button size="sm" variant="destructive" onClick={stopCaptureRecording} disabled={!isRecording}>
                  Stop Recording
                </Button>
              </div>
              <p className="mt-2 text-muted-foreground">
                {recordingStatusLabel} {isRecording ? `• ${recordingElapsedSec}s` : ""}
              </p>
              <Progress value={recordingUploadProgress} className="mt-1" />
              {recordingSessionId ? <p className="mt-1 text-[10px] text-muted-foreground">Session {recordingSessionId.slice(0, 8)}</p> : null}
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
              <p className="font-semibold text-foreground">Desktop Performance</p>
              <p>
                p95 open {perfHints?.observed.editorOpenP95Ms ?? "n/a"}ms / budget {perfHints?.budgets.editorOpenP95Ms ?? 2500}ms
              </p>
              <p>
                p95 command {perfHints?.observed.commandLatencyP95Ms ?? "n/a"}ms / budget {perfHints?.budgets.commandLatencyP95Ms ?? 100}ms
              </p>
              <p>
                Suggested windows: transcript {perfHints?.suggested.segmentWindowSize ?? segmentWindowSize}, timeline {perfHints?.suggested.timelineWindowSize ?? timelineWindowSize}
              </p>
              {perfHints?.hints.length ? (
                <ul className="mt-1 space-y-1">
                  {perfHints.hints.slice(0, 4).map((hint) => (
                    <li key={hint.id}>
                      [{hint.severity}] {hint.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No active perf warnings.</p>
              )}
              <p className="mt-1">
                Desktop shell: {desktopConfig?.desktop.status ?? "unknown"} • immediate replacement {desktopConfig?.cutover.immediateReplacement ? "on" : "off"}
              </p>
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
                <div className="rounded border p-2">
                  <p className="font-semibold">Batch speaker relabel</p>
                  <div className="mt-2 grid gap-2 grid-cols-2">
                    <Input
                      value={speakerBatchFromLabel}
                      onChange={(event) => setSpeakerBatchFromLabel(event.target.value)}
                      placeholder="From speaker (optional)"
                    />
                    <Input
                      value={speakerBatchToLabel}
                      onChange={(event) => setSpeakerBatchToLabel(event.target.value)}
                      placeholder="To speaker (empty clears)"
                    />
                  </div>
                  <div className="mt-2 grid gap-2 grid-cols-[1fr_auto]">
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={speakerBatchMaxConfidence}
                      onChange={(event) => setSpeakerBatchMaxConfidence(event.target.value)}
                      placeholder="Max confidence"
                    />
                    <Button size="sm" variant="secondary" onClick={applySpeakerBatch} disabled={busy !== null}>
                      Apply Batch
                    </Button>
                  </div>
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
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full"
                onClick={syncRangeFromSelectedSegment}
                disabled={!selectedSegment || busy !== null}
              >
                Sync Range From Selected Segment
              </Button>
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Low-confidence review queue ({lowConfidenceIssues.length})</p>
              <div className="mt-2 max-h-[130px] space-y-1 overflow-y-auto">
                {lowConfidenceIssues.slice(0, 40).map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    className="w-full rounded border px-2 py-1 text-left hover:bg-muted"
                    onClick={() => {
                      setSelectedSegmentId(issue.segmentId);
                      const segmentIndex = transcript?.segments.findIndex((segment) => segment.id === issue.segmentId) ?? 0;
                      setSegmentWindowStart(Math.max(0, segmentIndex - 8));
                    }}
                  >
                    <p className="font-medium">{formatMs(issue.startMs)} - {formatMs(issue.endMs)}</p>
                    <p className="line-clamp-1 text-muted-foreground">{issue.message}</p>
                  </button>
                ))}
                {lowConfidenceIssues.length === 0 ? (
                  <p className="text-muted-foreground">No low-confidence segments for the current threshold.</p>
                ) : null}
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
              <p className="font-semibold">Audio Quality Stack (Phase 3)</p>
              <p className="text-muted-foreground">Preview before apply. Every apply creates a new revision and undo token.</p>
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px]">Preset</Label>
                    <select
                      value={audioPreset}
                      onChange={(event) => setAudioPreset(event.target.value as AudioEnhancementPreset)}
                      className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
                    >
                      <option value="dialogue_enhance">Dialogue Enhance</option>
                      <option value="clean_voice">Clean Voice</option>
                      <option value="broadcast_loudness">Broadcast Loudness</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-[11px]">Target Loudness (LUFS)</Label>
                    <Input value={audioTargetLufs} onChange={(event) => setAudioTargetLufs(event.target.value)} />
                  </div>
                </div>
                <div>
                  <Label className="text-[11px]">Intensity</Label>
                  <Input value={audioIntensity} onChange={(event) => setAudioIntensity(event.target.value)} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Button size="sm" variant="secondary" onClick={previewAudioEnhancement} disabled={busy !== null}>
                    Preview
                  </Button>
                  <Button size="sm" onClick={applyAudioEnhancement} disabled={busy !== null || !audioAnalysis?.analysis.readyForApply}>
                    Apply
                  </Button>
                  <Button size="sm" variant="outline" onClick={undoAudioEnhancement} disabled={busy !== null || !audioUndoToken}>
                    Undo
                  </Button>
                </div>
              </div>

              <div className="mt-3 rounded border p-2">
                <p className="font-semibold">Filler removal</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input
                    value={fillerMaxCandidates}
                    onChange={(event) => setFillerMaxCandidates(event.target.value)}
                    placeholder="Max candidates"
                  />
                  <Input
                    value={fillerMaxConfidence}
                    onChange={(event) => setFillerMaxConfidence(event.target.value)}
                    placeholder="Max confidence"
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button size="sm" variant="secondary" onClick={previewFillerRemoval} disabled={busy !== null}>
                    Preview Filler Cut
                  </Button>
                  <Button size="sm" onClick={applyFillerRemoval} disabled={busy !== null}>
                    Apply Filler Cut
                  </Button>
                </div>
              </div>

              <div className="mt-3 rounded border p-2 text-muted-foreground">
                <p>Tracks: {audioAnalysis?.analysis.audioTrackCount ?? 0} • Clips: {audioAnalysis?.analysis.audioClipCount ?? 0}</p>
                <p>Noise score: {audioAnalysis?.analysis.estimatedNoiseLevel ?? 0} • Loudness: {audioAnalysis?.analysis.estimatedLoudnessLufs ?? 0} LUFS</p>
                <p>Recommended preset: {audioAnalysis?.analysis.recommendedPreset ?? "n/a"}</p>
                <p>Filler candidates: {audioAnalysis?.analysis.fillerCandidateCount ?? 0}</p>
              </div>

              {audioPreviewResult ? (
                <div className="mt-2 rounded border p-2 text-muted-foreground">
                  <p className="font-semibold text-foreground">Audio preview ready</p>
                  <p>Ops: {audioPreviewResult.timelineOps.length} • Issues: {audioPreviewResult.issues.length}</p>
                  <p>Noise {audioPreviewResult.analysisBefore.estimatedNoiseLevel} → {audioPreviewResult.analysisAfter.estimatedNoiseLevel}</p>
                  <p>Loudness {audioPreviewResult.analysisBefore.estimatedLoudnessLufs} → {audioPreviewResult.analysisAfter.estimatedLoudnessLufs} LUFS</p>
                </div>
              ) : null}

              {audioApplyResult ? (
                <div className="mt-2 rounded border p-2 text-muted-foreground">
                  <p className="font-semibold text-foreground">
                    {audioApplyResult.suggestionsOnly ? "Suggestions-only" : "Audio apply complete"}
                  </p>
                  <p>Revision: {audioApplyResult.revisionId ? audioApplyResult.revisionId.slice(0, 8) : "n/a"}</p>
                  <p>Undo token: {audioApplyResult.undoToken ? audioApplyResult.undoToken.slice(0, 8) : "n/a"}</p>
                </div>
              ) : null}

              {audioUndoResult ? (
                <div className="mt-2 rounded border p-2 text-muted-foreground">
                  <p className="font-semibold text-foreground">Audio rollback complete</p>
                  <p>Revision: {audioUndoResult.appliedRevisionId.slice(0, 8)}</p>
                </div>
              ) : null}

              {fillerPreviewResult ? (
                <div className="mt-2 rounded border p-2 text-muted-foreground">
                  <p className="font-semibold text-foreground">Filler preview</p>
                  <p>Candidates: {fillerPreviewResult.candidateCount} • Issues: {fillerPreviewResult.issues.length}</p>
                </div>
              ) : null}

              {fillerApplyResult ? (
                <div className="mt-2 rounded border p-2 text-muted-foreground">
                  <p className="font-semibold text-foreground">
                    {fillerApplyResult.suggestionsOnly ? "Filler suggestions-only" : "Filler apply complete"}
                  </p>
                  <p>Candidates: {fillerApplyResult.candidateCount}</p>
                  <p>Revision: {fillerApplyResult.revisionId ? fillerApplyResult.revisionId.slice(0, 8) : "n/a"}</p>
                </div>
              ) : null}
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Chat co-editor (Plan -&gt; Review -&gt; Apply)</p>
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
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={applyChatPlan}
                  disabled={
                    busy !== null ||
                    !chatPlan?.planRevisionHash ||
                    (chatPlan.executionMode === "APPLIED" && selectedChatOperationCount === 0)
                  }
                >
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
                  <p className="text-muted-foreground">
                    Safety mode: {chatPlan.safetyMode} • hash {chatPlan.planRevisionHash ? chatPlan.planRevisionHash.slice(0, 12) : "missing"}
                  </p>
                  <p className="text-muted-foreground">
                    Selected ops: {selectedChatOperationCount}/{totalSelectableChatOperations}
                  </p>
                  <div className="mt-2 max-h-[190px] space-y-1 overflow-y-auto">
                    {chatPlan.diffGroups.map((group) => (
                      <div key={group.group} className="rounded border px-2 py-1">
                        <p className="font-medium">{group.title}</p>
                        <p className="text-muted-foreground">{group.summary}</p>
                        {group.items.slice(0, 8).map((item) => {
                          const toggleable = item.type === "operation" && typeof item.operationIndex === "number";
                          const checked = chatOperationDecisions[item.id] ?? true;
                          return (
                            <label key={item.id} className="mt-1 flex items-center gap-2 text-muted-foreground">
                              {toggleable ? (
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleChatOperationDecision(item.id)}
                                />
                              ) : (
                                <span className="inline-block w-3" />
                              )}
                              <span>{item.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                    {!chatPlan.diffGroups.length ? <p className="text-muted-foreground">No grouped diffs returned.</p> : null}
                  </div>
                  <div className="mt-2 rounded border p-2 text-muted-foreground">
                    <p className="font-medium text-foreground">Confidence rationale</p>
                    <p>
                      Avg {chatPlan.confidenceRationale.averageConfidence.toFixed(2)} • Plan rate {chatPlan.confidenceRationale.validPlanRate.toFixed(2)}%
                    </p>
                    {chatPlan.confidenceRationale.fallbackReason ? (
                      <p>Fallback: {chatPlan.confidenceRationale.fallbackReason}</p>
                    ) : null}
                    {chatPlan.confidenceRationale.reasons.length > 0 ? (
                      <ul className="mt-1 space-y-1">
                        {chatPlan.confidenceRationale.reasons.slice(0, 4).map((reason, index) => (
                          <li key={`${reason}-${index}`}>- {reason}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No planner warnings.</p>
                    )}
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
                  <p className="text-muted-foreground">
                    Ops {chatApplyResult.selectedOperationCount ?? selectedChatOperationCount}/
                    {chatApplyResult.totalOperationCount ?? totalSelectableChatOperations}
                  </p>
                </div>
              ) : null}
              {chatUndoResult ? (
                <div className="mt-2 rounded border p-2">
                  <p className="font-semibold">Undo restored</p>
                  <p className="text-muted-foreground">Revision {chatUndoResult.appliedRevisionId.slice(0, 8)}</p>
                </div>
              ) : null}
              <div className="mt-2 rounded border p-2 text-muted-foreground">
                <p className="font-medium text-foreground">Chat sessions</p>
                <p>Total: {chatSessions.length}</p>
                <div className="mt-1 max-h-[90px] overflow-y-auto">
                  {chatSessions.slice(0, 5).map((session) => (
                    <p key={session.planId}>
                      {session.safetyMode} • {session.confidence.toFixed(2)} • {session.planId.slice(0, 8)}
                    </p>
                  ))}
                  {chatSessions.length === 0 ? <p>No chat sessions yet.</p> : null}
                </div>
              </div>
              <div className="mt-2 rounded border p-2 text-muted-foreground">
                <p className="font-medium text-foreground">Revision lineage</p>
                <p>Nodes: {revisionGraph?.nodeCount ?? 0} • Edges: {revisionGraph?.edgeCount ?? 0}</p>
                <div className="mt-1 max-h-[110px] overflow-y-auto">
                  {revisionGraph?.nodes.slice(-8).map((node) => (
                    <p key={node.revisionId}>
                      r{node.revisionNumber} • {node.source}
                      {node.isCurrent ? " (current)" : ""}
                    </p>
                  ))}
                  {!revisionGraph || revisionGraph.nodes.length === 0 ? <p>No revision graph yet.</p> : null}
                </div>
              </div>
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Collaboration + Review + Publishing (Phase 5)</p>
              <div className="mt-2 rounded border p-2">
                <p className="font-medium">Share links</p>
                <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                  <select
                    value={shareScope}
                    onChange={(event) => setShareScope(event.target.value as "VIEW" | "COMMENT" | "APPROVE")}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="VIEW">View</option>
                    <option value="COMMENT">Comment</option>
                    <option value="APPROVE">Approve</option>
                  </select>
                  <Input
                    value={shareExpiresDays}
                    onChange={(event) => setShareExpiresDays(event.target.value)}
                    placeholder="Expires days"
                  />
                  <Button size="sm" onClick={createShareLink} disabled={busy !== null}>
                    Create
                  </Button>
                </div>
                <div className="mt-2 max-h-[92px] space-y-1 overflow-y-auto text-muted-foreground">
                  {shareLinks.slice(0, 10).map((link) => (
                    <div key={link.id} className="rounded border px-2 py-1">
                      <p>
                        {link.scope} • {link.isActive ? "active" : "inactive"} • {link.tokenPrefix}...
                      </p>
                      <a className="underline" href={link.shareUrl} target="_blank" rel="noreferrer">
                        Open share link
                      </a>
                    </div>
                  ))}
                  {shareLinks.length === 0 ? <p>No share links yet.</p> : null}
                </div>
              </div>

              <div className="mt-2 rounded border p-2">
                <p className="font-medium">Review comments</p>
                <Textarea
                  rows={2}
                  value={reviewCommentBody}
                  onChange={(event) => setReviewCommentBody(event.target.value)}
                  placeholder="Leave feedback anchored to playhead/selection"
                />
                <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2">
                  <select
                    value={reviewCommentStatusFilter}
                    onChange={(event) => setReviewCommentStatusFilter(event.target.value as "ALL" | "OPEN" | "RESOLVED")}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="ALL">All</option>
                    <option value="OPEN">Open</option>
                    <option value="RESOLVED">Resolved</option>
                  </select>
                  <Button size="sm" variant="secondary" onClick={() => void loadReviewPublishing()} disabled={busy !== null}>
                    Refresh
                  </Button>
                  <Button size="sm" onClick={addReviewComment} disabled={busy !== null || !reviewCommentBody.trim()}>
                    Add Comment
                  </Button>
                </div>
                <div className="mt-2 max-h-[130px] space-y-1 overflow-y-auto text-muted-foreground">
                  {filteredReviewComments.slice(0, 24).map((comment) => (
                    <div key={comment.id} className="rounded border px-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-foreground">
                          {comment.status} • {formatMs(comment.anchorMs ?? 0)}
                        </p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2"
                          onClick={() => updateReviewComment(comment.id, comment.status === "OPEN" ? "RESOLVED" : "OPEN")}
                          disabled={busy !== null}
                        >
                          {comment.status === "OPEN" ? "Resolve" : "Reopen"}
                        </Button>
                      </div>
                      <p className="line-clamp-2">{comment.body}</p>
                    </div>
                  ))}
                  {filteredReviewComments.length === 0 ? <p>No review comments.</p> : null}
                </div>
              </div>

              <div className="mt-2 rounded border p-2">
                <p className="font-medium">Approval and export</p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="review-approval-required"
                    type="checkbox"
                    checked={reviewApprovalRequired}
                    onChange={(event) => setReviewApprovalRequired(event.target.checked)}
                  />
                  <Label htmlFor="review-approval-required">Require approval before render</Label>
                </div>
                <Textarea
                  rows={2}
                  value={reviewDecisionNote}
                  onChange={(event) => setReviewDecisionNote(event.target.value)}
                  placeholder="Approval note (optional)"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button size="sm" onClick={() => submitReviewDecision("APPROVED")} disabled={busy !== null}>
                    Approve Revision
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => submitReviewDecision("REJECTED")} disabled={busy !== null}>
                    Reject Revision
                  </Button>
                </div>
                {reviewLatestDecision ? (
                  <p className="mt-2 text-muted-foreground">
                    Latest decision: {reviewLatestDecision.status} • {new Date(reviewLatestDecision.createdAt).toLocaleString()}
                  </p>
                ) : (
                  <p className="mt-2 text-muted-foreground">No review decision yet.</p>
                )}

                <div className="mt-3 rounded border p-2">
                  <p className="font-medium">Export profiles</p>
                  <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                    <select
                      value={selectedExportProfileId}
                      onChange={(event) => setSelectedExportProfileId(event.target.value)}
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                    >
                      <option value="">Select profile...</option>
                      {exportProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name} ({profile.resolution}@{profile.fps})
                        </option>
                      ))}
                    </select>
                    <Button size="sm" onClick={applyExistingExportProfile} disabled={busy !== null || !selectedExportProfileId}>
                      Apply
                    </Button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Input
                      value={newExportProfileName}
                      onChange={(event) => setNewExportProfileName(event.target.value)}
                      placeholder="Profile name"
                    />
                    <Input
                      value={newExportProfileResolution}
                      onChange={(event) => setNewExportProfileResolution(event.target.value)}
                      placeholder="1080x1920"
                    />
                    <Input
                      value={newExportProfileFps}
                      onChange={(event) => setNewExportProfileFps(event.target.value)}
                      placeholder="30"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2 w-full"
                    onClick={createAndApplyExportProfile}
                    disabled={busy !== null || !newExportProfileName.trim()}
                  >
                    Create Profile
                  </Button>
                </div>
              </div>
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
