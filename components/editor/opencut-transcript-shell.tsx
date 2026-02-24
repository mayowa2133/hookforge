"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  autoTranscript,
  getAiJob,
  getLegacyProject,
  getRenderJob,
  getTimeline,
  getTranscript,
  patchTimeline,
  patchTranscript,
  presignProjectAsset,
  registerProjectAsset,
  runChatEdit,
  startRender,
  undoChatEdit,
  type ChatEditResponse,
  type LegacyProjectPayload,
  type TimelineOperation,
  type TimelinePayload,
  type TranscriptPayload
} from "@/lib/opencut/hookforge-client";
import { clampPlaybackSeekSeconds, computeSplitPointMs, computeTrackReorderTarget } from "@/lib/opencut/timeline-helpers";

type OpenCutTranscriptShellProps = {
  projectV2Id: string;
  legacyProjectId: string;
  title: string;
  status: string;
};

function formatMs(ms: number) {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((safe % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
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

function summarizeOps(ops: ChatEditResponse["plannedOperations"], max = 4) {
  const lines = ops.slice(0, max).map((op, index) => {
    const payload = Object.entries(op)
      .filter(([key]) => key !== "op")
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");
    return `${index + 1}. ${op.op}${payload ? ` ${payload}` : ""}`;
  });
  if (ops.length > max) {
    lines.push(`+${ops.length - max} more operation(s)`);
  }
  return lines;
}

function acceptForKinds(kinds: Array<"VIDEO" | "IMAGE" | "AUDIO">) {
  const map: Record<"VIDEO" | "IMAGE" | "AUDIO", string> = {
    VIDEO: "video/*",
    IMAGE: "image/*",
    AUDIO: "audio/*"
  };
  return kinds.map((kind) => map[kind]).join(",");
}

export function OpenCutTranscriptShell({ projectV2Id, legacyProjectId, title, status }: OpenCutTranscriptShellProps) {
  const [project, setProject] = useState<LegacyProjectPayload["project"] | null>(null);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
  const [language, setLanguage] = useState("en");
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [selectedClipId, setSelectedClipId] = useState("");
  const [segmentDraft, setSegmentDraft] = useState("");
  const [speakerDraft, setSpeakerDraft] = useState("");
  const [previewOnly, setPreviewOnly] = useState(false);
  const [minConfidenceForRipple, setMinConfidenceForRipple] = useState(0.86);
  const [busy, setBusy] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [opResult, setOpResult] = useState<{
    applied: boolean;
    suggestionsOnly: boolean;
    issues: Array<{ code: string; message: string; severity: "INFO" | "WARN" | "ERROR" }>;
    revisionId: string | null;
  } | null>(null);
  const [timelineResult, setTimelineResult] = useState<{
    revisionId: string | null;
    revision: number;
  } | null>(null);
  const [autoJobId, setAutoJobId] = useState<string | null>(null);
  const [autoJobStatus, setAutoJobStatus] = useState<{ status: string; progress: number } | null>(null);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<{
    status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
    progress: number;
    outputUrl: string | null;
    errorMessage: string | null;
  } | null>(null);
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatAttachmentIds, setChatAttachmentIds] = useState("");
  const [chatResult, setChatResult] = useState<ChatEditResponse | null>(null);
  const [chatUndoToken, setChatUndoToken] = useState<string | null>(null);
  const [chatUndoResult, setChatUndoResult] = useState<{ restored: boolean; appliedRevisionId: string } | null>(null);
  const [chatJobId, setChatJobId] = useState<string | null>(null);
  const [chatJobStatus, setChatJobStatus] = useState<{ status: string; progress: number } | null>(null);
  const [uploadingSlotKey, setUploadingSlotKey] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [deleteStartMs, setDeleteStartMs] = useState("0");
  const [deleteEndMs, setDeleteEndMs] = useState("220");
  const [clipMoveInMs, setClipMoveInMs] = useState("0");
  const [clipDurationMs, setClipDurationMs] = useState("1200");
  const [trimStartMs, setTrimStartMs] = useState("0");
  const [trimEndMs, setTrimEndMs] = useState("0");
  const [playheadMs, setPlayheadMs] = useState(0);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const selectedSegment = useMemo(
    () => transcript?.segments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [selectedSegmentId, transcript?.segments]
  );

  const orderedTracks = useMemo(() => {
    const tracks = timeline?.timeline.tracks ?? [];
    return [...tracks].sort((a, b) => a.order - b.order);
  }, [timeline?.timeline.tracks]);

  const selectedTrack = useMemo(
    () => orderedTracks.find((track) => track.id === selectedTrackId) ?? null,
    [orderedTracks, selectedTrackId]
  );

  const selectedClip = useMemo(() => {
    if (!selectedTrack) {
      return null;
    }
    return selectedTrack.clips.find((clip) => clip.id === selectedClipId) ?? null;
  }, [selectedTrack, selectedClipId]);

  const previewAsset = useMemo(() => pickPreviewAsset(project), [project]);
  const slotDefinitions = useMemo(() => project?.template.slotSchema.slots ?? [], [project?.template.slotSchema.slots]);
  const assetBySlot = useMemo(() => {
    const entries = new Map<string, LegacyProjectPayload["project"]["assets"][number]>();
    for (const asset of project?.assets ?? []) {
      entries.set(asset.slotKey, asset);
    }
    return entries;
  }, [project?.assets]);
  const missingRequiredSlots = useMemo(
    () => slotDefinitions.filter((slot) => slot.required && !assetBySlot.get(slot.key)).map((slot) => slot.key),
    [assetBySlot, slotDefinitions]
  );
  const canRender = missingRequiredSlots.length === 0 && project?.status !== "RENDERING";

  const loadProjectSurface = async () => {
    const [projectPayload, timelinePayload] = await Promise.all([getLegacyProject(projectV2Id), getTimeline(projectV2Id)]);
    setProject(projectPayload.project);
    setTimeline(timelinePayload);
  };

  const loadTranscript = async () => {
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
    setDeleteEndMs(String(Math.min(active.endMs, active.startMs + 220)));
  };

  const syncSelectedClipDraft = (trackId: string, clipId: string, nextTimeline?: TimelinePayload | null) => {
    const sourceTimeline = nextTimeline ?? timeline;
    if (!sourceTimeline) {
      return;
    }
    const track = sourceTimeline.timeline.tracks.find((entry) => entry.id === trackId);
    const clip = track?.clips.find((entry) => entry.id === clipId);
    if (!track || !clip) {
      return;
    }

    setSelectedTrackId(track.id);
    setSelectedClipId(clip.id);
    setClipMoveInMs(String(clip.timelineInMs));
    setClipDurationMs(String(Math.max(120, clip.timelineOutMs - clip.timelineInMs)));
    setTrimStartMs("0");
    setTrimEndMs("0");
  };

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
  }, [projectV2Id, language]);

  useEffect(() => {
    if (!orderedTracks.length) {
      setSelectedTrackId("");
      setSelectedClipId("");
      return;
    }

    const hasTrack = orderedTracks.some((track) => track.id === selectedTrackId);
    const fallbackTrack = hasTrack ? orderedTracks.find((track) => track.id === selectedTrackId) ?? orderedTracks[0] : orderedTracks[0];
    const fallbackClip = fallbackTrack.clips[0] ?? null;

    if (!hasTrack) {
      setSelectedTrackId(fallbackTrack.id);
    }

    const hasClip = fallbackTrack.clips.some((clip) => clip.id === selectedClipId);
    if (!hasClip) {
      if (fallbackClip) {
        syncSelectedClipDraft(fallbackTrack.id, fallbackClip.id);
      } else {
        setSelectedClipId("");
      }
    }
  }, [orderedTracks, selectedClipId, selectedTrackId]);

  useEffect(() => {
    if (!autoJobId) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const payload = await getAiJob(autoJobId);
        setAutoJobStatus({
          status: payload.aiJob.status,
          progress: payload.aiJob.progress
        });

        if (payload.aiJob.status === "DONE") {
          await Promise.all([loadTranscript(), loadProjectSurface()]);
          setAutoJobId(null);
        }
        if (payload.aiJob.status === "ERROR" || payload.aiJob.status === "CANCELED") {
          setPanelError(payload.aiJob.errorMessage ?? `Auto transcript job ${payload.aiJob.status.toLowerCase()}`);
          setAutoJobId(null);
        }
      } catch (error) {
        setPanelError(error instanceof Error ? error.message : "Failed to poll AI job");
        setAutoJobId(null);
      }
    }, 2200);

    return () => clearInterval(interval);
  }, [autoJobId]);

  useEffect(() => {
    if (!renderJobId) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const payload = await getRenderJob(renderJobId);
        setRenderStatus(payload.renderJob);
        if (payload.renderJob.status === "DONE" || payload.renderJob.status === "ERROR") {
          await loadProjectSurface();
          setRenderJobId(null);
        }
      } catch (error) {
        setPanelError(error instanceof Error ? error.message : "Failed to poll render job");
        setRenderJobId(null);
      }
    }, 2200);

    return () => clearInterval(interval);
  }, [renderJobId]);

  useEffect(() => {
    if (!chatJobId) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const payload = await getAiJob(chatJobId);
        setChatJobStatus({
          status: payload.aiJob.status,
          progress: payload.aiJob.progress
        });
        if (payload.aiJob.status === "DONE") {
          await Promise.all([loadProjectSurface(), loadTranscript()]);
          setChatJobId(null);
        }
        if (payload.aiJob.status === "ERROR" || payload.aiJob.status === "CANCELED") {
          setPanelError(payload.aiJob.errorMessage ?? `Chat edit job ${payload.aiJob.status.toLowerCase()}`);
          setChatJobId(null);
        }
      } catch (error) {
        setPanelError(error instanceof Error ? error.message : "Failed to poll chat edit job");
        setChatJobId(null);
      }
    }, 2200);

    return () => clearInterval(interval);
  }, [chatJobId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || busy !== null) {
        return;
      }

      const video = previewVideoRef.current;
      if (!video) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        if (video.paused) {
          void video.play();
        } else {
          video.pause();
        }
        return;
      }

      if (key === "j") {
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

      if (key === "k") {
        event.preventDefault();
        video.pause();
        return;
      }

      if (key === "l") {
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

      if (key === "s" && selectedTrack && selectedClip) {
        event.preventDefault();
        const splitMs = computeSplitPointMs(
          {
            timelineInMs: selectedClip.timelineInMs,
            timelineOutMs: selectedClip.timelineOutMs
          },
          playheadMs
        );
        void applyTimelineOperations(
          [
            {
              op: "split_clip",
              trackId: selectedTrack.id,
              clipId: selectedClip.id,
              splitMs
            }
          ],
          "timeline_split"
        );
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, playheadMs, selectedClip, selectedTrack]);

  const runAutoTranscript = async () => {
    setBusy("auto");
    setPanelError(null);
    setOpResult(null);
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

  const applyTranscriptOperation = async (
    operations: Array<
      | { op: "replace_text"; segmentId: string; text: string }
      | { op: "split_segment"; segmentId: string; splitMs: number }
      | { op: "merge_segments"; firstSegmentId: string; secondSegmentId: string }
      | { op: "delete_range"; startMs: number; endMs: number }
      | { op: "set_speaker"; segmentId: string; speakerLabel: string | null }
      | { op: "normalize_punctuation"; segmentIds?: string[] }
    >,
    action: string
  ) => {
    setBusy(action);
    setPanelError(null);
    setOpResult(null);
    try {
      const payload = await patchTranscript(projectV2Id, {
        language,
        operations,
        minConfidenceForRipple,
        previewOnly
      });
      setOpResult({
        applied: payload.applied,
        suggestionsOnly: payload.suggestionsOnly,
        issues: payload.issues,
        revisionId: payload.revisionId
      });
      await Promise.all([loadTranscript(), loadProjectSurface()]);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Transcript operation failed");
    } finally {
      setBusy(null);
    }
  };

  const applyTimelineOperations = async (operations: TimelineOperation[], action: string) => {
    setBusy(action);
    setPanelError(null);
    setTimelineResult(null);
    try {
      const payload = await patchTimeline(projectV2Id, operations);
      setTimeline(payload);
      setTimelineResult({
        revisionId: payload.revisionId,
        revision: payload.revision
      });
      await loadTranscript();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Timeline operation failed");
    } finally {
      setBusy(null);
    }
  };

  const replaceText = async () => {
    if (!selectedSegment || !segmentDraft.trim()) {
      return;
    }
    await applyTranscriptOperation(
      [
        {
          op: "replace_text",
          segmentId: selectedSegment.id,
          text: segmentDraft.trim()
        }
      ],
      "replace_text"
    );
  };

  const splitSegment = async () => {
    if (!selectedSegment) {
      return;
    }
    const midpoint = selectedSegment.startMs + Math.floor((selectedSegment.endMs - selectedSegment.startMs) / 2);
    await applyTranscriptOperation(
      [
        {
          op: "split_segment",
          segmentId: selectedSegment.id,
          splitMs: Math.max(selectedSegment.startMs + 100, midpoint)
        }
      ],
      "split_segment"
    );
  };

  const mergeWithNext = async () => {
    if (!transcript || !selectedSegment) {
      return;
    }
    const currentIndex = transcript.segments.findIndex((segment) => segment.id === selectedSegment.id);
    const nextSegment = currentIndex >= 0 ? transcript.segments[currentIndex + 1] : null;
    if (!nextSegment) {
      return;
    }
    await applyTranscriptOperation(
      [
        {
          op: "merge_segments",
          firstSegmentId: selectedSegment.id,
          secondSegmentId: nextSegment.id
        }
      ],
      "merge_segments"
    );
  };

  const saveSpeaker = async () => {
    if (!selectedSegment) {
      return;
    }
    await applyTranscriptOperation(
      [
        {
          op: "set_speaker",
          segmentId: selectedSegment.id,
          speakerLabel: speakerDraft.trim() ? speakerDraft.trim() : null
        }
      ],
      "set_speaker"
    );
  };

  const deleteRange = async () => {
    const start = Number(deleteStartMs);
    const end = Number(deleteEndMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setPanelError("Delete range requires valid start/end ms.");
      return;
    }
    await applyTranscriptOperation(
      [
        {
          op: "delete_range",
          startMs: Math.max(0, Math.floor(start)),
          endMs: Math.floor(end)
        }
      ],
      "delete_range"
    );
  };

  const normalizePunctuation = async () => {
    await applyTranscriptOperation(
      [
        {
          op: "normalize_punctuation"
        }
      ],
      "normalize_punctuation"
    );
  };

  const runTimelineSplit = async () => {
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
      [
        {
          op: "split_clip",
          trackId: selectedTrack.id,
          clipId: selectedClip.id,
          splitMs
        }
      ],
      "timeline_split"
    );
  };

  const runTimelineTrim = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    const start = Math.max(0, Math.floor(Number(trimStartMs) || 0));
    const end = Math.max(0, Math.floor(Number(trimEndMs) || 0));
    await applyTimelineOperations(
      [
        {
          op: "trim_clip",
          trackId: selectedTrack.id,
          clipId: selectedClip.id,
          trimStartMs: start,
          trimEndMs: end
        }
      ],
      "timeline_trim"
    );
  };

  const runTimelineMove = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    const nextIn = Math.max(0, Math.floor(Number(clipMoveInMs) || 0));
    await applyTimelineOperations(
      [
        {
          op: "move_clip",
          trackId: selectedTrack.id,
          clipId: selectedClip.id,
          timelineInMs: nextIn
        }
      ],
      "timeline_move"
    );
  };

  const runTimelineSetTiming = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    const nextIn = Math.max(0, Math.floor(Number(clipMoveInMs) || 0));
    const nextDuration = Math.max(120, Math.floor(Number(clipDurationMs) || 1200));
    await applyTimelineOperations(
      [
        {
          op: "set_clip_timing",
          trackId: selectedTrack.id,
          clipId: selectedClip.id,
          timelineInMs: nextIn,
          durationMs: nextDuration
        }
      ],
      "timeline_set_timing"
    );
  };

  const runTimelineMerge = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    await applyTimelineOperations(
      [
        {
          op: "merge_clip_with_next",
          trackId: selectedTrack.id,
          clipId: selectedClip.id
        }
      ],
      "timeline_merge"
    );
  };

  const runTimelineRemove = async () => {
    if (!selectedTrack || !selectedClip) {
      return;
    }
    await applyTimelineOperations(
      [
        {
          op: "remove_clip",
          trackId: selectedTrack.id,
          clipId: selectedClip.id
        }
      ],
      "timeline_remove"
    );
  };

  const reorderTrack = async (trackId: string, currentOrder: number, direction: -1 | 1) => {
    const nextOrder = computeTrackReorderTarget(currentOrder, direction, orderedTracks.length);
    if (nextOrder === currentOrder) {
      return;
    }
    await applyTimelineOperations(
      [
        {
          op: "reorder_track",
          trackId,
          order: nextOrder
        }
      ],
      "timeline_reorder"
    );
  };

  const uploadSlotAsset = async (slotKey: string, file: File) => {
    const mimeType = file.type || "application/octet-stream";
    setUploadingSlotKey(slotKey);
    setUploadErrors((current) => ({ ...current, [slotKey]: "" }));
    setPanelError(null);

    try {
      const presign = await presignProjectAsset(projectV2Id, {
        slotKey,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size
      });

      const uploadResponse = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": mimeType
        },
        body: file
      });
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }

      await registerProjectAsset(projectV2Id, {
        slotKey,
        storageKey: presign.storageKey,
        mimeType
      });

      await Promise.all([loadProjectSurface(), loadTranscript()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setUploadErrors((current) => ({ ...current, [slotKey]: message }));
      setPanelError(message);
    } finally {
      setUploadingSlotKey(null);
    }
  };

  const onSlotFileChange = async (slotKey: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }
    await uploadSlotAsset(slotKey, file);
  };

  const applyChatEdit = async () => {
    if (chatPrompt.trim().length < 4) {
      setPanelError("Chat prompt must be at least 4 characters.");
      return;
    }

    const attachmentAssetIds = chatAttachmentIds
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    setBusy("chat_edit");
    setPanelError(null);
    setChatUndoResult(null);

    try {
      const payload = await runChatEdit(projectV2Id, {
        prompt: chatPrompt.trim(),
        attachmentAssetIds: attachmentAssetIds.length > 0 ? attachmentAssetIds : undefined
      });

      setChatResult(payload);
      setChatUndoToken(payload.undoToken);
      setChatJobId(payload.aiJobId);
      setChatJobStatus({ status: "QUEUED", progress: 0 });

      if (payload.executionMode === "APPLIED") {
        await Promise.all([loadProjectSurface(), loadTranscript()]);
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Chat edit failed");
    } finally {
      setBusy(null);
    }
  };

  const applyChatUndo = async () => {
    if (!chatUndoToken) {
      setPanelError("No undo token is available for chat undo.");
      return;
    }

    setBusy("chat_undo");
    setPanelError(null);

    try {
      const payload = await undoChatEdit(projectV2Id, {
        undoToken: chatUndoToken
      });
      setChatUndoResult({
        restored: payload.restored,
        appliedRevisionId: payload.appliedRevisionId
      });
      await Promise.all([loadProjectSurface(), loadTranscript()]);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Chat undo failed");
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
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Render failed to start");
    } finally {
      setBusy(null);
    }
  };

  const trackCount = orderedTracks.length;
  const clipCount = orderedTracks.reduce((sum, track) => sum + track.clips.length, 0);

  return (
    <div className="-mx-2 space-y-4 md:-mx-4 lg:-mx-8">
      <div className="rounded-xl border bg-background/95 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">OpenCut Shell (Phase 4)</p>
            <h1 className="text-2xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
              {title}
            </h1>
            <p className="text-xs text-muted-foreground">
              Legacy project: {legacyProjectId} • Status: {status}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Transcript-first + timeline + AI chat + media import/export</Badge>
            <Badge variant="secondary">V2 ID: {projectV2Id.slice(0, 8)}</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.25fr_1fr]">
        <Card className="min-h-[580px]">
          <CardHeader>
            <CardTitle className="text-lg">Transcript</CardTitle>
            <CardDescription>Edit text first, timeline updates through safe patch operations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Input value={language} onChange={(event) => setLanguage(event.target.value)} className="h-8 max-w-[84px]" />
              <Button size="sm" onClick={runAutoTranscript} disabled={busy !== null}>
                Generate
              </Button>
              {autoJobStatus ? (
                <div className="min-w-[150px] flex-1">
                  <p className="text-[11px] text-muted-foreground">
                    AI {autoJobStatus.status} ({autoJobStatus.progress}%)
                  </p>
                  <Progress value={autoJobStatus.progress} />
                </div>
              ) : null}
            </div>

            <div className="space-y-2 rounded-md border p-2">
              <p className="text-xs font-semibold">Media Import</p>
              <p className="text-xs text-muted-foreground">
                Upload your own assets only. Templates are structure blueprints; you must have rights to all uploaded media.
              </p>
              <div className="max-h-[180px] space-y-2 overflow-y-auto">
                {slotDefinitions.map((slot) => {
                  const currentAsset = assetBySlot.get(slot.key);
                  const busyThisSlot = uploadingSlotKey === slot.key;
                  return (
                    <div key={slot.key} className="rounded-md border p-2">
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <p className="text-xs font-medium">
                          {slot.label} <span className="text-muted-foreground">({slot.key})</span>
                        </p>
                        <Badge variant={currentAsset ? "secondary" : "outline"}>
                          {currentAsset ? "Uploaded" : slot.required ? "Required" : "Optional"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="file"
                          className="h-8"
                          accept={acceptForKinds(slot.kinds)}
                          disabled={busyThisSlot}
                          onChange={(event) => {
                            void onSlotFileChange(slot.key, event);
                          }}
                        />
                        <span className="text-[11px] text-muted-foreground">{busyThisSlot ? "Uploading..." : slot.kinds.join("/")}</span>
                      </div>
                      {slot.helpText ? <p className="mt-1 text-[11px] text-muted-foreground">{slot.helpText}</p> : null}
                      {currentAsset ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Current: {currentAsset.kind} • {currentAsset.mimeType}
                        </p>
                      ) : null}
                      {uploadErrors[slot.key] ? <p className="mt-1 text-[11px] text-destructive">{uploadErrors[slot.key]}</p> : null}
                    </div>
                  );
                })}
              </div>
              {missingRequiredSlots.length > 0 ? (
                <p className="text-[11px] text-muted-foreground">Missing required slots: {missingRequiredSlots.join(", ")}</p>
              ) : (
                <p className="text-[11px] text-emerald-600">All required slots uploaded.</p>
              )}
            </div>

            <div className="max-h-[440px] space-y-2 overflow-y-auto rounded-md border p-2">
              {transcript?.segments.length ? (
                transcript.segments.map((segment) => (
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
                    className={`w-full rounded-md border px-2 py-2 text-left text-xs transition ${
                      segment.id === selectedSegmentId ? "border-primary bg-primary/10" : "hover:bg-muted"
                    }`}
                  >
                    <p className="font-semibold">
                      {formatMs(segment.startMs)} - {formatMs(segment.endMs)}
                    </p>
                    <p className="line-clamp-2 text-muted-foreground">{segment.text}</p>
                  </button>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No transcript segments yet. Generate transcript to begin.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-[580px]">
          <CardHeader>
            <CardTitle className="text-lg">Transcript Ops</CardTitle>
            <CardDescription>Deterministic transcript patch operations with conservative ripple safety.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Segment Text</Label>
              <Textarea
                value={segmentDraft}
                onChange={(event) => setSegmentDraft(event.target.value)}
                rows={4}
                placeholder="Select a segment to edit text"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button size="sm" disabled={!selectedSegment || busy !== null} onClick={replaceText}>
                Replace Text
              </Button>
              <Button size="sm" variant="secondary" disabled={!selectedSegment || busy !== null} onClick={splitSegment}>
                Split Segment
              </Button>
              <Button size="sm" variant="secondary" disabled={!selectedSegment || busy !== null} onClick={mergeWithNext}>
                Merge With Next
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={normalizePunctuation}>
                Normalize Punctuation
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <Input
                value={speakerDraft}
                onChange={(event) => setSpeakerDraft(event.target.value)}
                placeholder="Speaker label (optional)"
              />
              <Button size="sm" variant="secondary" disabled={!selectedSegment || busy !== null} onClick={saveSpeaker}>
                Set Speaker
              </Button>
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <Input value={deleteStartMs} onChange={(event) => setDeleteStartMs(event.target.value)} placeholder="Start ms" />
              <Input value={deleteEndMs} onChange={(event) => setDeleteEndMs(event.target.value)} placeholder="End ms" />
              <Button size="sm" variant="destructive" disabled={busy !== null} onClick={deleteRange}>
                Delete Range
              </Button>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <input
                id="preview-only-patch"
                type="checkbox"
                checked={previewOnly}
                onChange={(event) => setPreviewOnly(event.target.checked)}
              />
              <Label htmlFor="preview-only-patch">Preview only (suggestions mode)</Label>
            </div>

            <div className="space-y-1">
              <Label>Min Confidence For Ripple</Label>
              <Input
                type="number"
                min={0.55}
                max={0.99}
                step={0.01}
                value={minConfidenceForRipple}
                onChange={(event) => setMinConfidenceForRipple(Number(event.target.value))}
              />
            </div>

            <div className="space-y-2 border-t pt-3">
              <div>
                <p className="text-sm font-semibold">AI Co-Editor (Phase 3)</p>
                <p className="text-xs text-muted-foreground">
                  Ask for timeline edits in natural language. Unsafe plans fall back to suggestions-only mode.
                </p>
              </div>
              <Textarea
                value={chatPrompt}
                onChange={(event) => setChatPrompt(event.target.value)}
                rows={3}
                placeholder="Example: tighten pauses, cut first second, then move the first caption clip 300ms earlier"
              />
              <Input
                value={chatAttachmentIds}
                onChange={(event) => setChatAttachmentIds(event.target.value)}
                placeholder="Optional attachment asset IDs (comma-separated)"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" disabled={busy !== null} onClick={applyChatEdit}>
                  Apply Chat Edit
                </Button>
                <Button size="sm" variant="outline" disabled={busy !== null || !chatUndoToken} onClick={applyChatUndo}>
                  Undo Last Chat Apply
                </Button>
              </div>

              {chatJobStatus ? (
                <div className="rounded-md border p-2 text-xs">
                  <p className="text-muted-foreground">
                    Chat job {chatJobStatus.status} ({chatJobStatus.progress}%)
                  </p>
                  <Progress value={chatJobStatus.progress} />
                </div>
              ) : null}

              {chatResult ? (
                <div className="rounded-md border p-2 text-xs">
                  <p className="font-semibold">
                    {chatResult.executionMode === "APPLIED" ? "Applied" : "Suggestions only"} • confidence{" "}
                    {Math.round(chatResult.planValidation.confidence * 100)}%
                  </p>
                  <p className="text-muted-foreground">
                    {chatResult.appliedRevisionId ? `Revision ${chatResult.appliedRevisionId.slice(0, 8)}` : "No revision applied"} •{" "}
                    {chatResult.undoToken ? `undo token ${chatResult.undoToken.slice(0, 8)}` : "no undo token"}
                  </p>
                  {chatResult.fallbackReason ? <p className="mt-1 text-amber-600">Fallback: {chatResult.fallbackReason}</p> : null}
                  {chatResult.planValidation.reason ? (
                    <p className="mt-1 text-muted-foreground">Validation: {chatResult.planValidation.reason}</p>
                  ) : null}
                  {chatResult.invariantIssues.length > 0 ? (
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      {chatResult.invariantIssues.map((issue, index) => (
                        <li key={`${issue.code}-${index}`}>
                          [{issue.severity}] {issue.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {chatResult.plannedOperations.length > 0 ? (
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                      {summarizeOps(chatResult.plannedOperations).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-muted-foreground">No operations planned.</p>
                  )}
                  {chatResult.constrainedSuggestions.length > 0 ? (
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                      {chatResult.constrainedSuggestions.slice(0, 4).map((suggestion) => (
                        <li key={suggestion}>{suggestion}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {chatUndoResult ? (
                <div className="rounded-md border p-2 text-xs">
                  <p className="font-semibold">Chat undo restored timeline</p>
                  <p className="text-muted-foreground">Revision {chatUndoResult.appliedRevisionId.slice(0, 8)}</p>
                </div>
              ) : null}
            </div>

            {opResult ? (
              <div className="rounded-md border p-2 text-xs">
                <p className="font-semibold">
                  {opResult.suggestionsOnly ? "Suggestions only" : "Applied"}{" "}
                  {opResult.revisionId ? `(rev ${opResult.revisionId.slice(0, 8)})` : ""}
                </p>
                {opResult.issues.length > 0 ? (
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    {opResult.issues.map((issue, index) => (
                      <li key={`${issue.code}-${index}`}>
                        [{issue.severity}] {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">No issues reported.</p>
                )}
              </div>
            ) : null}

            {timelineResult ? (
              <div className="rounded-md border p-2 text-xs">
                <p className="font-semibold">Timeline updated</p>
                <p className="text-muted-foreground">
                  Revision {timelineResult.revision}
                  {timelineResult.revisionId ? ` (${timelineResult.revisionId.slice(0, 8)})` : ""}
                </p>
              </div>
            ) : null}

            {panelError ? <p className="text-xs text-destructive">{panelError}</p> : null}
          </CardContent>
        </Card>

        <Card className="min-h-[580px]">
          <CardHeader>
            <CardTitle className="text-lg">Preview + Timeline</CardTitle>
            <CardDescription>Interactive timeline controls plus final cloud render/export.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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

            <div className="rounded-md border p-2 text-xs text-muted-foreground">
              Shortcuts: <span className="font-semibold text-foreground">Space</span> play/pause, <span className="font-semibold text-foreground">J/K/L</span>{" "}
              seek/pause, <span className="font-semibold text-foreground">S</span> split selected clip at playhead ({formatMs(playheadMs)}).
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void loadProjectSurface()} disabled={busy !== null}>
                Refresh Timeline
              </Button>
              <Button size="sm" variant="secondary" onClick={enqueueRender} disabled={busy !== null || !canRender}>
                Render MP4
              </Button>
            </div>

            {!canRender ? (
              <p className="text-xs text-muted-foreground">Upload required slots before rendering: {missingRequiredSlots.join(", ")}</p>
            ) : null}

            {renderStatus ? (
              <div className="space-y-1 rounded-md border p-2 text-xs">
                <p>
                  Render {renderStatus.status} ({renderStatus.progress}%)
                </p>
                <Progress value={renderStatus.progress} />
                {renderStatus.outputUrl ? (
                  <a href={renderStatus.outputUrl} className="font-semibold underline" target="_blank" rel="noreferrer">
                    Download render
                  </a>
                ) : null}
                {renderStatus.errorMessage ? <p className="text-destructive">{renderStatus.errorMessage}</p> : null}
              </div>
            ) : null}

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">
                Tracks {trackCount} • Clips {clipCount}
              </p>

              <div className="mt-2 max-h-[260px] space-y-1 overflow-y-auto">
                {orderedTracks.map((track) => (
                  <div key={track.id} className={`rounded border p-1 ${track.id === selectedTrackId ? "border-primary" : ""}`}>
                    <div className="flex items-center justify-between gap-1">
                      <button
                        type="button"
                        className="text-left font-medium"
                        onClick={() => {
                          setSelectedTrackId(track.id);
                          if (track.clips[0]) {
                            syncSelectedClipDraft(track.id, track.clips[0].id);
                          }
                        }}
                      >
                        {track.name} ({track.kind}) • {track.clips.length} clips
                      </button>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => void reorderTrack(track.id, track.order, -1)}>
                          ↑
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => void reorderTrack(track.id, track.order, 1)}>
                          ↓
                        </Button>
                      </div>
                    </div>

                    <div className="mt-1 space-y-1">
                      {track.clips.slice(0, 8).map((clip) => (
                        <button
                          key={clip.id}
                          type="button"
                          className={`w-full rounded border px-1 py-0.5 text-left ${clip.id === selectedClipId ? "border-primary bg-primary/10" : ""}`}
                          onClick={() => syncSelectedClipDraft(track.id, clip.id)}
                        >
                          {(clip.label ?? "Untitled clip").slice(0, 36)} [{formatMs(clip.timelineInMs)} - {formatMs(clip.timelineOutMs)}]
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {!orderedTracks.length ? <p className="text-muted-foreground">Timeline is empty.</p> : null}
              </div>
            </div>

            <div className="rounded-md border p-2 text-xs">
              <p className="font-semibold">Selected clip controls</p>
              {selectedTrack && selectedClip ? (
                <div className="mt-2 space-y-2">
                  <p className="text-muted-foreground">
                    {selectedTrack.name} • {(selectedClip.label ?? "Untitled clip").slice(0, 40)}
                  </p>

                  <div className="grid gap-2 grid-cols-2">
                    <Input value={clipMoveInMs} onChange={(event) => setClipMoveInMs(event.target.value)} placeholder="timelineInMs" />
                    <Input value={clipDurationMs} onChange={(event) => setClipDurationMs(event.target.value)} placeholder="durationMs" />
                  </div>

                  <div className="grid gap-2 grid-cols-2">
                    <Input value={trimStartMs} onChange={(event) => setTrimStartMs(event.target.value)} placeholder="trimStartMs" />
                    <Input value={trimEndMs} onChange={(event) => setTrimEndMs(event.target.value)} placeholder="trimEndMs" />
                  </div>

                  <div className="grid gap-2 grid-cols-2">
                    <Button size="sm" onClick={runTimelineMove} disabled={busy !== null}>
                      Move Clip
                    </Button>
                    <Button size="sm" variant="secondary" onClick={runTimelineSetTiming} disabled={busy !== null}>
                      Set Timing
                    </Button>
                    <Button size="sm" variant="secondary" onClick={runTimelineTrim} disabled={busy !== null}>
                      Trim Clip
                    </Button>
                    <Button size="sm" variant="secondary" onClick={runTimelineSplit} disabled={busy !== null}>
                      Split at Playhead
                    </Button>
                    <Button size="sm" variant="outline" onClick={runTimelineMerge} disabled={busy !== null}>
                      Merge Next
                    </Button>
                    <Button size="sm" variant="destructive" onClick={runTimelineRemove} disabled={busy !== null}>
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 text-muted-foreground">Select a clip to enable timeline controls.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
