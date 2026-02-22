"use client";

import { useEffect, useMemo, useState } from "react";
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
  patchTranscript,
  startRender,
  type LegacyProjectPayload,
  type TimelinePayload,
  type TranscriptPayload
} from "@/lib/opencut/hookforge-client";

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

export function OpenCutTranscriptShell({ projectV2Id, legacyProjectId, title, status }: OpenCutTranscriptShellProps) {
  const [project, setProject] = useState<LegacyProjectPayload["project"] | null>(null);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
  const [language, setLanguage] = useState("en");
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
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
  const [autoJobId, setAutoJobId] = useState<string | null>(null);
  const [autoJobStatus, setAutoJobStatus] = useState<{ status: string; progress: number } | null>(null);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<{
    status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
    progress: number;
    outputUrl: string | null;
    errorMessage: string | null;
  } | null>(null);
  const [deleteStartMs, setDeleteStartMs] = useState("0");
  const [deleteEndMs, setDeleteEndMs] = useState("220");

  const selectedSegment = useMemo(
    () => transcript?.segments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [selectedSegmentId, transcript?.segments]
  );

  const previewAsset = useMemo(() => pickPreviewAsset(project), [project]);

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

  const trackCount = timeline?.timeline.tracks.length ?? 0;
  const clipCount = timeline?.timeline.tracks.reduce((sum, track) => sum + track.clips.length, 0) ?? 0;

  return (
    <div className="-mx-2 space-y-4 md:-mx-4 lg:-mx-8">
      <div className="rounded-xl border bg-background/95 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">OpenCut Shell (Phase 1)</p>
            <h1 className="text-2xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
              {title}
            </h1>
            <p className="text-xs text-muted-foreground">
              Legacy project: {legacyProjectId} • Status: {status}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Transcript-first</Badge>
            <Badge variant="secondary">V2 ID: {projectV2Id.slice(0, 8)}</Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1.2fr_0.9fr]">
        <Card className="min-h-[540px]">
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

            <div className="max-h-[410px] space-y-2 overflow-y-auto rounded-md border p-2">
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
                    <p className="font-semibold">{formatMs(segment.startMs)} - {formatMs(segment.endMs)}</p>
                    <p className="line-clamp-2 text-muted-foreground">{segment.text}</p>
                  </button>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">No transcript segments yet. Generate transcript to begin.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-[540px]">
          <CardHeader>
            <CardTitle className="text-lg">Editor</CardTitle>
            <CardDescription>Transcript actions are deterministic and ripple-safe.</CardDescription>
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

            {opResult ? (
              <div className="rounded-md border p-2 text-xs">
                <p className="font-semibold">
                  {opResult.suggestionsOnly ? "Suggestions only" : "Applied"} {opResult.revisionId ? `(rev ${opResult.revisionId.slice(0, 8)})` : ""}
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

            {panelError ? <p className="text-xs text-destructive">{panelError}</p> : null}
          </CardContent>
        </Card>

        <Card className="min-h-[540px]">
          <CardHeader>
            <CardTitle className="text-lg">Preview + Timeline</CardTitle>
            <CardDescription>Read-only timeline rail in Phase 1 with render support.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {previewAsset ? (
              <video src={previewAsset.signedUrl} controls playsInline className="aspect-[9/16] w-full rounded-md border object-cover" />
            ) : (
              <div className="rounded-md border p-4 text-xs text-muted-foreground">No preview video asset yet.</div>
            )}

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void loadProjectSurface()} disabled={busy !== null}>
                Refresh Timeline
              </Button>
              <Button size="sm" variant="secondary" onClick={enqueueRender} disabled={busy !== null}>
                Render MP4
              </Button>
            </div>

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
              <div className="mt-2 max-h-[180px] space-y-1 overflow-y-auto">
                {timeline?.timeline.tracks.map((track) => (
                  <div key={track.id} className="rounded border p-1">
                    <p className="font-medium">
                      {track.name} ({track.kind}) • {track.clips.length} clips
                    </p>
                    {track.clips.slice(0, 4).map((clip) => (
                      <p key={clip.id} className="text-muted-foreground">
                        {clip.label} [{formatMs(clip.timelineInMs)} - {formatMs(clip.timelineOutMs)}]
                      </p>
                    ))}
                  </div>
                ))}
                {!timeline?.timeline.tracks.length ? <p className="text-muted-foreground">Timeline is empty.</p> : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
