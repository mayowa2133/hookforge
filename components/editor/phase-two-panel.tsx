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
  const [aiJobs, setAiJobs] = useState<Record<string, AiJobLite>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await fetchCaptions();
      } catch {
        if (!cancelled) {
          setCaptionSummary(null);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
      const response = await fetch(`/api/projects/${projectId}/captions/auto`, {
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
        throw new Error(payload.error ?? "Auto caption request failed");
      }
      if (payload.aiJobId) {
        registerJob(payload.aiJobId, "TRANSCRIBE");
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : "Auto caption request failed");
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
