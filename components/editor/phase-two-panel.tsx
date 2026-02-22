"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChatEditOperation } from "@/lib/ai/chat-edit";

type AiJobLite = {
  id: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "ERROR" | "CANCELED";
  progress: number;
  errorMessage?: string | null;
};

type CaptionSummary = {
  byLanguage: Record<
    string,
    Array<{
      id: string;
      text: string;
      startMs: number;
      endMs: number;
    }>
  >;
  transcriptWords: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
  }>;
};

type TranscriptSummary = {
  language: string;
  segments: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
    speakerLabel: string | null;
    confidenceAvg: number | null;
  }>;
  words: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
    confidence: number | null;
  }>;
  qualitySummary: {
    wordCount: number;
    segmentCount: number;
    averageConfidence: number;
  };
};

type PhaseTwoPanelProps = {
  projectId: string;
  onTimelineRefresh: () => Promise<void>;
};

function parseTargetLanguages(input: string) {
  return [...new Set(input.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

export function PhaseTwoPanel({ projectId, onTimelineRefresh }: PhaseTwoPanelProps) {
  const [autoLanguage, setAutoLanguage] = useState("en");
  const [diarization, setDiarization] = useState(false);
  const [punctuationStyle, setPunctuationStyle] = useState<"auto" | "minimal" | "full">("auto");
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.86);
  const [reDecodeEnabled, setReDecodeEnabled] = useState(true);
  const [maxWordsPerSegment, setMaxWordsPerSegment] = useState(7);
  const [maxCharsPerLine, setMaxCharsPerLine] = useState(24);
  const [maxLinesPerSegment, setMaxLinesPerSegment] = useState(2);
  const [targetLanguagesInput, setTargetLanguagesInput] = useState("es,fr");
  const [translateTone, setTranslateTone] = useState("neutral");
  const [aiEditStyle, setAiEditStyle] = useState("punchy");
  const [includeBroll, setIncludeBroll] = useState(true);
  const [includeMusic, setIncludeMusic] = useState(true);
  const [includeSfx, setIncludeSfx] = useState(true);
  const [chatPrompt, setChatPrompt] = useState("Split the intro, tighten pacing, and improve caption style.");
  const [lastUndoToken, setLastUndoToken] = useState("");
  const [lastPlannedOps, setLastPlannedOps] = useState<ChatEditOperation[]>([]);
  const [captionSummary, setCaptionSummary] = useState<CaptionSummary | null>(null);
  const [transcriptSummary, setTranscriptSummary] = useState<TranscriptSummary | null>(null);
  const [aiJobs, setAiJobs] = useState<Record<string, AiJobLite>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [transcriptOpResult, setTranscriptOpResult] = useState<{
    applied: boolean;
    suggestionsOnly: boolean;
    issues: Array<{ code: string; message: string; severity: "INFO" | "WARN" | "ERROR" }>;
    revisionId: string | null;
  } | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string>("");
  const [segmentDraftText, setSegmentDraftText] = useState<string>("");
  const [speakerDraft, setSpeakerDraft] = useState<string>("");
  const [deleteStartMs, setDeleteStartMs] = useState<string>("0");
  const [deleteEndMs, setDeleteEndMs] = useState<string>("220");
  const [previewOnlyPatch, setPreviewOnlyPatch] = useState(false);

  const pendingJobs = useMemo(
    () => Object.values(aiJobs).filter((job) => job.status === "QUEUED" || job.status === "RUNNING"),
    [aiJobs]
  );

  const registerJob = (jobId: string, type: string) => {
    setAiJobs((current) => ({
      ...current,
      [jobId]: {
        id: jobId,
        type,
        status: "QUEUED",
        progress: 0
      }
    }));
  };

  const fetchCaptions = async () => {
    const response = await fetch(`/api/projects/${projectId}/captions`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to fetch captions");
    }
    setCaptionSummary({
      byLanguage: payload.byLanguage ?? {},
      transcriptWords: payload.transcriptWords ?? []
    });
  };

  const fetchTranscript = async () => {
    const response = await fetch(`/api/projects/${projectId}/transcript?language=${encodeURIComponent(autoLanguage)}`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to fetch transcript");
    }

    const summary = payload as TranscriptSummary;
    setTranscriptSummary(summary);

    const firstSegment = summary.segments[0];
    if (firstSegment && !activeSegmentId) {
      setActiveSegmentId(firstSegment.id);
      setSegmentDraftText(firstSegment.text);
      setSpeakerDraft(firstSegment.speakerLabel ?? "");
      setDeleteStartMs(String(firstSegment.startMs));
      setDeleteEndMs(String(Math.min(firstSegment.endMs, firstSegment.startMs + 220)));
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await fetchCaptions();
        await fetchTranscript();
      } catch {
        if (!cancelled) {
          setCaptionSummary(null);
          setTranscriptSummary(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, autoLanguage]);

  useEffect(() => {
    if (!transcriptSummary || transcriptSummary.segments.length === 0) {
      return;
    }
    const stillExists = transcriptSummary.segments.some((segment) => segment.id === activeSegmentId);
    if (!stillExists) {
      selectSegment(transcriptSummary.segments[0].id);
    }
  }, [activeSegmentId, transcriptSummary]);

  useEffect(() => {
    if (pendingJobs.length === 0) {
      return;
    }

    const poll = setInterval(async () => {
      for (const job of pendingJobs) {
        try {
          const response = await fetch(`/api/ai-jobs/${job.id}`);
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error ?? "AI job polling failed");
          }
          const next = payload.aiJob as AiJobLite;
          setAiJobs((current) => ({
            ...current,
            [next.id]: next
          }));

          if (next.status === "DONE") {
            await fetchCaptions();
            await fetchTranscript();
            await onTimelineRefresh();
          }
        } catch (error) {
          setPanelError(error instanceof Error ? error.message : "AI job polling failed");
        }
      }
    }, 2200);

    return () => clearInterval(poll);
  }, [onTimelineRefresh, pendingJobs]);

  const runAutoCaptions = async () => {
    setBusyAction("auto");
    setPanelError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/transcript/auto`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          language: autoLanguage,
          diarization,
          punctuationStyle,
          confidenceThreshold: Number.isFinite(confidenceThreshold) ? confidenceThreshold : 0.86,
          reDecodeEnabled,
          maxWordsPerSegment: Number.isFinite(maxWordsPerSegment) ? maxWordsPerSegment : 7,
          maxCharsPerLine: Number.isFinite(maxCharsPerLine) ? maxCharsPerLine : 24,
          maxLinesPerSegment: Number.isFinite(maxLinesPerSegment) ? maxLinesPerSegment : 2
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Auto transcript request failed");
      }
      if (payload.aiJobId) {
        registerJob(payload.aiJobId, "TRANSCRIBE");
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Auto transcript request failed");
    } finally {
      setBusyAction(null);
    }
  };

  const patchTranscript = async (operations: Array<Record<string, unknown>>, actionName: string) => {
    setBusyAction(actionName);
    setPanelError(null);
    setTranscriptOpResult(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/transcript`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          language: autoLanguage,
          operations,
          minConfidenceForRipple: Number.isFinite(confidenceThreshold) ? confidenceThreshold : 0.86,
          previewOnly: previewOnlyPatch
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Transcript patch failed");
      }

      setTranscriptOpResult({
        applied: Boolean(payload.applied),
        suggestionsOnly: Boolean(payload.suggestionsOnly),
        issues: (payload.issues ?? []) as Array<{ code: string; message: string; severity: "INFO" | "WARN" | "ERROR" }>,
        revisionId: (payload.revisionId as string | null) ?? null
      });

      await fetchTranscript();
      await fetchCaptions();
      await onTimelineRefresh();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Transcript patch failed");
    } finally {
      setBusyAction(null);
    }
  };

  const runTranslation = async () => {
    setBusyAction("translate");
    setPanelError(null);
    try {
      const targetLanguages = parseTargetLanguages(targetLanguagesInput);
      if (targetLanguages.length === 0) {
        throw new Error("Enter at least one target language code.");
      }

      const response = await fetch(`/api/projects/${projectId}/captions/translate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceLanguage: autoLanguage,
          targetLanguages,
          tone: translateTone
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Caption translation failed");
      }
      if (payload.translationJobId) {
        registerJob(payload.translationJobId, "CAPTION_TRANSLATE");
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Caption translation failed");
    } finally {
      setBusyAction(null);
    }
  };

  const runAiEdit = async () => {
    setBusyAction("ai-edit");
    setPanelError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/ai-edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          styleId: aiEditStyle,
          includeBroll,
          includeMusic,
          includeSfx
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "AI edit request failed");
      }
      if (payload.aiEditJobId) {
        registerJob(payload.aiEditJobId, "AI_EDIT");
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "AI edit request failed");
    } finally {
      setBusyAction(null);
    }
  };

  const runChatEdit = async () => {
    setBusyAction("chat");
    setPanelError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/chat-edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: chatPrompt
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Chat edit failed");
      }
      setLastUndoToken(payload.undoToken ?? "");
      setLastPlannedOps(payload.plannedOperations ?? []);
      if (payload.aiJobId) {
        registerJob(payload.aiJobId, "CHAT_EDIT");
      }
      await onTimelineRefresh();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Chat edit failed");
    } finally {
      setBusyAction(null);
    }
  };

  const undoChatEdit = async () => {
    if (!lastUndoToken) {
      setPanelError("No undo token available yet.");
      return;
    }
    setBusyAction("undo");
    setPanelError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/chat-edit/undo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          undoToken: lastUndoToken
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Undo failed");
      }
      setLastUndoToken("");
      await onTimelineRefresh();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Undo failed");
    } finally {
      setBusyAction(null);
    }
  };

  const activeSegment = transcriptSummary?.segments.find((segment) => segment.id === activeSegmentId) ?? null;

  const selectSegment = (segmentId: string) => {
    const segment = transcriptSummary?.segments.find((entry) => entry.id === segmentId);
    setActiveSegmentId(segmentId);
    if (segment) {
      setSegmentDraftText(segment.text);
      setSpeakerDraft(segment.speakerLabel ?? "");
      setDeleteStartMs(String(segment.startMs));
      setDeleteEndMs(String(Math.min(segment.endMs, segment.startMs + 220)));
    }
  };

  const applyReplaceText = async () => {
    if (!activeSegmentId || !segmentDraftText.trim()) {
      setPanelError("Select a transcript segment and provide replacement text.");
      return;
    }
    await patchTranscript(
      [{ op: "replace_text", segmentId: activeSegmentId, text: segmentDraftText.trim() }],
      "tx-replace"
    );
  };

  const applySplitSegment = async () => {
    if (!activeSegment) {
      setPanelError("Select a transcript segment to split.");
      return;
    }
    const midpoint = activeSegment.startMs + Math.floor((activeSegment.endMs - activeSegment.startMs) / 2);
    await patchTranscript(
      [{ op: "split_segment", segmentId: activeSegment.id, splitMs: midpoint }],
      "tx-split"
    );
  };

  const applyMergeWithNext = async () => {
    if (!activeSegment || !transcriptSummary) {
      setPanelError("Select a transcript segment to merge.");
      return;
    }
    const index = transcriptSummary.segments.findIndex((segment) => segment.id === activeSegment.id);
    const next = index >= 0 ? transcriptSummary.segments[index + 1] : null;
    if (!next) {
      setPanelError("Selected segment has no next segment to merge.");
      return;
    }
    await patchTranscript(
      [{ op: "merge_segments", firstSegmentId: activeSegment.id, secondSegmentId: next.id }],
      "tx-merge"
    );
  };

  const applySetSpeaker = async () => {
    if (!activeSegmentId) {
      setPanelError("Select a transcript segment first.");
      return;
    }
    await patchTranscript(
      [{ op: "set_speaker", segmentId: activeSegmentId, speakerLabel: speakerDraft.trim() || null }],
      "tx-speaker"
    );
  };

  const applyDeleteRange = async () => {
    const startMs = Number(deleteStartMs);
    const endMs = Number(deleteEndMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      setPanelError("Delete range is invalid.");
      return;
    }
    await patchTranscript(
      [{ op: "delete_range", startMs, endMs }],
      "tx-delete"
    );
  };

  const applyNormalizePunctuation = async () => {
    await patchTranscript(
      activeSegmentId
        ? [{ op: "normalize_punctuation", segmentIds: [activeSegmentId] }]
        : [{ op: "normalize_punctuation" }],
      "tx-normalize"
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Studio (Phase 2)</CardTitle>
        <CardDescription>Auto captions, translation, AI edit styles, and chat-based timeline edits.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Auto Captions</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Language</Label>
              <Input value={autoLanguage} onChange={(event) => setAutoLanguage(event.target.value)} placeholder="en" />
            </div>
            <div className="space-y-1">
              <Label>Punctuation</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={punctuationStyle}
                onChange={(event) => setPunctuationStyle(event.target.value as "auto" | "minimal" | "full")}
              >
                <option value="auto">Auto</option>
                <option value="minimal">Minimal</option>
                <option value="full">Full</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label>Confidence gate</Label>
              <Input
                type="number"
                min={0.55}
                max={0.99}
                step={0.01}
                value={confidenceThreshold}
                onChange={(event) => setConfidenceThreshold(Number(event.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label>Words/segment</Label>
              <Input
                type="number"
                min={3}
                max={12}
                step={1}
                value={maxWordsPerSegment}
                onChange={(event) => setMaxWordsPerSegment(Number(event.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label>Chars/line</Label>
              <Input
                type="number"
                min={14}
                max={42}
                step={1}
                value={maxCharsPerLine}
                onChange={(event) => setMaxCharsPerLine(Number(event.target.value))}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={diarization} onChange={(event) => setDiarization(event.target.checked)} />
            Enable diarization labels
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={reDecodeEnabled} onChange={(event) => setReDecodeEnabled(event.target.checked)} />
            Re-decode with fallback provider if confidence gate fails
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={maxLinesPerSegment === 2}
              onChange={(event) => setMaxLinesPerSegment(event.target.checked ? 2 : 1)}
            />
            Style-safe captions (2 lines max)
          </label>
          <Button size="sm" onClick={() => void runAutoCaptions()} disabled={busyAction !== null}>
            {busyAction === "auto" ? "Queueing..." : "Generate Auto Captions"}
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Caption Translation</p>
          <div className="space-y-1">
            <Label>Target languages (comma-separated)</Label>
            <Input
              value={targetLanguagesInput}
              onChange={(event) => setTargetLanguagesInput(event.target.value)}
              placeholder="es,fr,de"
            />
          </div>
          <div className="space-y-1">
            <Label>Tone</Label>
            <Input value={translateTone} onChange={(event) => setTranslateTone(event.target.value)} placeholder="neutral" />
          </div>
          <Button size="sm" onClick={() => void runTranslation()} disabled={busyAction !== null}>
            {busyAction === "translate" ? "Queueing..." : "Translate Captions"}
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">AI Edit</p>
          <div className="space-y-1">
            <Label>Style Pack</Label>
            <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={aiEditStyle} onChange={(event) => setAiEditStyle(event.target.value)}>
              <option value="punchy">Punchy</option>
              <option value="cinematic">Cinematic</option>
              <option value="kinetic">Kinetic</option>
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={includeBroll} onChange={(event) => setIncludeBroll(event.target.checked)} />
              B-roll
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={includeMusic} onChange={(event) => setIncludeMusic(event.target.checked)} />
              Music
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={includeSfx} onChange={(event) => setIncludeSfx(event.target.checked)} />
              SFX
            </label>
          </div>
          <Button size="sm" onClick={() => void runAiEdit()} disabled={busyAction !== null}>
            {busyAction === "ai-edit" ? "Queueing..." : "Apply AI Edit"}
          </Button>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Chat Edit</p>
          <div className="space-y-1">
            <Label>Prompt</Label>
            <Input value={chatPrompt} onChange={(event) => setChatPrompt(event.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void runChatEdit()} disabled={busyAction !== null}>
              {busyAction === "chat" ? "Applying..." : "Apply Chat Edit"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void undoChatEdit()} disabled={busyAction !== null || !lastUndoToken}>
              {busyAction === "undo" ? "Reverting..." : "Undo Last Chat Edit"}
            </Button>
          </div>
          {lastUndoToken ? <p className="text-[11px] text-muted-foreground">Undo token: {lastUndoToken}</p> : null}
          {lastPlannedOps.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Last planned operations</p>
              <div className="flex flex-wrap gap-1">
                {lastPlannedOps.map((operation, index) => (
                  <Badge key={`${operation.op}-${index}`} variant="secondary" className="text-[10px]">
                    {operation.op}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Transcript Editing</p>
          {!transcriptSummary ? (
            <p className="text-xs text-muted-foreground">No transcript loaded yet. Generate transcript first.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {transcriptSummary.language} • {transcriptSummary.qualitySummary.segmentCount} segments •{" "}
                {transcriptSummary.qualitySummary.wordCount} words • avg confidence{" "}
                {(transcriptSummary.qualitySummary.averageConfidence * 100).toFixed(1)}%
              </p>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded border p-2">
                {transcriptSummary.segments.map((segment) => (
                  <button
                    key={segment.id}
                    type="button"
                    className={`w-full rounded border px-2 py-1 text-left text-xs ${
                      activeSegmentId === segment.id ? "border-primary bg-primary/10" : "border-border"
                    }`}
                    onClick={() => selectSegment(segment.id)}
                  >
                    <p className="font-medium">
                      {segment.startMs}ms - {segment.endMs}ms {segment.speakerLabel ? `• ${segment.speakerLabel}` : ""}
                    </p>
                    <p className="truncate text-muted-foreground">{segment.text}</p>
                  </button>
                ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Segment Text</Label>
                  <Input
                    value={segmentDraftText}
                    onChange={(event) => setSegmentDraftText(event.target.value)}
                    placeholder="Edit transcript text"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Speaker</Label>
                  <Input
                    value={speakerDraft}
                    onChange={(event) => setSpeakerDraft(event.target.value)}
                    placeholder="Speaker 1"
                  />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={deleteStartMs}
                  onChange={(event) => setDeleteStartMs(event.target.value)}
                  type="number"
                  placeholder="Delete start (ms)"
                />
                <Input
                  value={deleteEndMs}
                  onChange={(event) => setDeleteEndMs(event.target.value)}
                  type="number"
                  placeholder="Delete end (ms)"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={previewOnlyPatch} onChange={(event) => setPreviewOnlyPatch(event.target.checked)} />
                Preview only (do not persist changes)
              </label>

              <div className="grid gap-2 sm:grid-cols-3">
                <Button size="sm" variant="outline" onClick={() => void applyReplaceText()} disabled={busyAction !== null}>
                  {busyAction === "tx-replace" ? "Applying..." : "Replace Text"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void applySplitSegment()} disabled={busyAction !== null}>
                  {busyAction === "tx-split" ? "Applying..." : "Split Segment"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void applyMergeWithNext()} disabled={busyAction !== null}>
                  {busyAction === "tx-merge" ? "Applying..." : "Merge With Next"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void applySetSpeaker()} disabled={busyAction !== null}>
                  {busyAction === "tx-speaker" ? "Applying..." : "Set Speaker"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void applyDeleteRange()} disabled={busyAction !== null}>
                  {busyAction === "tx-delete" ? "Applying..." : "Delete Range"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void applyNormalizePunctuation()} disabled={busyAction !== null}>
                  {busyAction === "tx-normalize" ? "Applying..." : "Normalize Punctuation"}
                </Button>
              </div>

              {transcriptOpResult ? (
                <div className="rounded border p-2 text-xs">
                  <p>
                    {transcriptOpResult.applied ? "Applied" : "Not applied"} • suggestionsOnly:{" "}
                    {String(transcriptOpResult.suggestionsOnly)} • revision: {transcriptOpResult.revisionId ?? "none"}
                  </p>
                  {transcriptOpResult.issues.length > 0 ? (
                    <div className="mt-1 space-y-1">
                      {transcriptOpResult.issues.map((issue, index) => (
                        <p key={`${issue.code}-${index}`} className="text-muted-foreground">
                          [{issue.severity}] {issue.code}: {issue.message}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">AI Job Status</p>
          <div className="space-y-1">
            {Object.values(aiJobs).length === 0 ? (
              <p className="text-xs text-muted-foreground">No AI jobs submitted in this session.</p>
            ) : (
              Object.values(aiJobs)
                .sort((a, b) => a.id.localeCompare(b.id))
                .map((job) => (
                  <div key={job.id} className="rounded border px-2 py-1 text-xs">
                    <p>
                      {job.type} • {job.status} • {job.progress}%
                    </p>
                    {job.errorMessage ? <p className="text-destructive">{job.errorMessage}</p> : null}
                  </div>
                ))
            )}
          </div>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">Caption Output</p>
          {!captionSummary ? (
            <p className="text-xs text-muted-foreground">No caption data available yet.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Transcript words: {captionSummary.transcriptWords.length}
              </p>
              <div className="space-y-1">
                {Object.entries(captionSummary.byLanguage).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No caption segments yet.</p>
                ) : (
                  Object.entries(captionSummary.byLanguage).map(([language, segments]) => (
                    <div key={language} className="rounded border px-2 py-1 text-xs">
                      <p className="font-medium">
                        {language} • {segments.length} segments
                      </p>
                      <p className="truncate text-muted-foreground">{segments[0]?.text ?? ""}</p>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {panelError ? <p className="text-xs text-destructive">{panelError}</p> : null}
      </CardContent>
    </Card>
  );
}
