"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type AiJob = {
  id: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "ERROR" | "CANCELED";
  progress: number;
  errorMessage?: string | null;
  output?: unknown;
};

type AuditResponse = {
  summary: {
    rightsAttestationCount: number;
    sourceLinkCount: number;
    trustEventCount: number;
    takedownCount: number;
    flaggedCount: number;
    sourceTypeBreakdown: Record<string, number>;
  };
  rightsAttestations: Array<{
    id: string;
    sourceType: string;
    sourceUrl: string;
    statement: string;
    createdAt: string;
  }>;
  trustEvents: Array<{
    id: string;
    eventType: string;
    severity: string;
    summary: string;
    createdAt: string;
  }>;
};

function jobProjectLinks(job: AiJob) {
  const output = job.output as
    | {
        sideEffects?: {
          phase4?: {
            legacyProjectId?: string;
            editableProjects?: Array<{ legacyProjectId: string; title?: string }>;
          };
        };
      }
    | undefined;

  const phase4 = output?.sideEffects?.phase4;
  if (!phase4) {
    return [] as Array<{ id: string; title: string }>;
  }

  const links: Array<{ id: string; title: string }> = [];
  if (phase4.legacyProjectId) {
    links.push({ id: phase4.legacyProjectId, title: "Primary project" });
  }
  for (const project of phase4.editableProjects ?? []) {
    links.push({ id: project.legacyProjectId, title: project.title ?? "Generated short" });
  }

  return [...new Map(links.map((item) => [item.id, item])).values()];
}

export function Phase4Lab() {
  const [jobs, setJobs] = useState<Record<string, AiJob>>({});
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [adsWebsiteUrl, setAdsWebsiteUrl] = useState("https://example.com");
  const [adsProductName, setAdsProductName] = useState("HookForge");
  const [adsTone, setAdsTone] = useState("ugc");
  const [adsStatement, setAdsStatement] = useState("I confirm I have rights to use this website content for ad ideation and script generation.");
  const [adsAttested, setAdsAttested] = useState(true);

  const [shortsSourceUrl, setShortsSourceUrl] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const [shortsClipCount, setShortsClipCount] = useState("3");
  const [shortsLanguage, setShortsLanguage] = useState("en");
  const [shortsDurationSec, setShortsDurationSec] = useState("180");
  const [shortsStatement, setShortsStatement] = useState("I confirm I own or have permission to process this source URL.");
  const [shortsAttested, setShortsAttested] = useState(true);

  const [redditUrl, setRedditUrl] = useState("https://www.reddit.com/r/Entrepreneur/comments/abc123/example_thread/");
  const [redditTitle, setRedditTitle] = useState("How did you get your first 1000 users?");
  const [redditBody, setRedditBody] = useState("Share practical lessons and common mistakes to avoid.");
  const [redditClipCount, setRedditClipCount] = useState("2");
  const [redditStatement, setRedditStatement] = useState("I confirm I have rights to use this Reddit source context for structural transformation.");
  const [redditAttested, setRedditAttested] = useState(true);

  const [takedownUrl, setTakedownUrl] = useState("");
  const [takedownReason, setTakedownReason] = useState("Rights owner requested removal and source deactivation.");

  const pendingJobIds = useMemo(
    () => Object.values(jobs).filter((job) => job.status === "QUEUED" || job.status === "RUNNING").map((job) => job.id),
    [jobs]
  );

  const refreshAudit = async () => {
    const response = await fetch("/api/compliance/audit");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load compliance audit");
    }
    setAudit(payload as AuditResponse);
  };

  const registerJob = (job: AiJob) => {
    setJobs((current) => ({
      ...current,
      [job.id]: job
    }));
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        await refreshAudit();
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load compliance audit");
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pendingJobIds.length === 0) {
      return;
    }

    const poll = setInterval(async () => {
      for (const jobId of pendingJobIds) {
        try {
          const response = await fetch(`/api/ai-jobs/${jobId}`);
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error ?? "Failed to poll AI job");
          }

          const nextJob = payload.aiJob as AiJob;
          registerJob(nextJob);

          if (nextJob.status === "DONE" || nextJob.status === "ERROR") {
            await refreshAudit();
          }
        } catch (pollError) {
          setError(pollError instanceof Error ? pollError.message : "Failed to poll AI job");
        }
      }
    }, 2200);

    return () => clearInterval(poll);
  }, [pendingJobIds]);

  const submitAiAds = async () => {
    setBusyAction("ads");
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/ai-ads/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          websiteUrl: adsWebsiteUrl,
          productName: adsProductName,
          tone: adsTone,
          durationSec: 30,
          rightsAttested: adsAttested,
          statement: adsStatement
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "AI Ads request failed");
      }

      registerJob({
        id: payload.aiJobId as string,
        type: "AI_ADS",
        status: "QUEUED",
        progress: 0,
        output: {
          sideEffects: {
            phase4: {
              legacyProjectId: payload.legacyProjectId
            }
          }
        }
      });

      setSuccess(`AI Ads queued. Credits reserved: ${payload.creditEstimate}.`);
      await refreshAudit();
    } catch (adsError) {
      setError(adsError instanceof Error ? adsError.message : "AI Ads request failed");
    } finally {
      setBusyAction(null);
    }
  };

  const submitAiShorts = async () => {
    setBusyAction("shorts");
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/ai-shorts/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceUrl: shortsSourceUrl,
          clipCount: Number(shortsClipCount),
          language: shortsLanguage,
          sourceDurationSec: Number(shortsDurationSec),
          rightsAttested: shortsAttested,
          statement: shortsStatement
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "AI Shorts request failed");
      }

      registerJob({
        id: payload.aiJobId as string,
        type: "AI_SHORTS",
        status: "QUEUED",
        progress: 0
      });

      setSuccess(`AI Shorts queued. Credits reserved: ${payload.creditEstimate}.`);
      await refreshAudit();
    } catch (shortsError) {
      setError(shortsError instanceof Error ? shortsError.message : "AI Shorts request failed");
    } finally {
      setBusyAction(null);
    }
  };

  const submitRedditFlow = async () => {
    setBusyAction("reddit");
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/reddit-to-video/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          redditUrl,
          postTitle: redditTitle,
          postBody: redditBody,
          clipCount: Number(redditClipCount),
          language: "en",
          rightsAttested: redditAttested,
          statement: redditStatement
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Reddit-to-video request failed");
      }

      registerJob({
        id: payload.aiJobId as string,
        type: "AI_SHORTS",
        status: "QUEUED",
        progress: 0
      });

      setSuccess(`Reddit-to-video queued. Credits reserved: ${payload.creditEstimate}.`);
      await refreshAudit();
    } catch (redditError) {
      setError(redditError instanceof Error ? redditError.message : "Reddit-to-video request failed");
    } finally {
      setBusyAction(null);
    }
  };

  const submitTakedown = async () => {
    setBusyAction("takedown");
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/compliance/takedown", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceUrl: takedownUrl,
          reason: takedownReason
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Takedown submission failed");
      }

      setSuccess(`Takedown recorded. Affected links: ${payload.affectedLinks}.`);
      await refreshAudit();
    } catch (takedownError) {
      setError(takedownError instanceof Error ? takedownError.message : "Takedown submission failed");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
          Growth Lab (Phase 4)
        </h1>
        <p className="text-sm text-muted-foreground">
          AI Ads, AI Shorts, Reddit-to-video, and rights/compliance auditing with takedown controls.
        </p>
      </div>

      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="pt-6 text-sm text-amber-900">
          URL workflows are rights-attested only. HookForge does not scrape or rip media from social platforms.
        </CardContent>
      </Card>

      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {success ? <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700">{success}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>AI Ads</CardTitle>
            <CardDescription>Generate a UGC-style ad draft from a rights-attested website URL.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Website URL</Label>
              <Input value={adsWebsiteUrl} onChange={(event) => setAdsWebsiteUrl(event.target.value)} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Product name</Label>
                <Input value={adsProductName} onChange={(event) => setAdsProductName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Tone</Label>
                <Input value={adsTone} onChange={(event) => setAdsTone(event.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Rights statement</Label>
              <Textarea value={adsStatement} onChange={(event) => setAdsStatement(event.target.value)} rows={3} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={adsAttested} onChange={(event) => setAdsAttested(event.target.checked)} />
              I attest this URL is authorized for structural ad generation.
            </label>
            <Button onClick={submitAiAds} disabled={busyAction === "ads"}>{busyAction === "ads" ? "Queueing..." : "Generate AI Ad"}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Shorts</CardTitle>
            <CardDescription>Generate highlight shorts from a source URL (including YouTube when rights-attested).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Source URL</Label>
              <Input value={shortsSourceUrl} onChange={(event) => setShortsSourceUrl(event.target.value)} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label>Clip count</Label>
                <Input value={shortsClipCount} onChange={(event) => setShortsClipCount(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Language</Label>
                <Input value={shortsLanguage} onChange={(event) => setShortsLanguage(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Source duration (sec)</Label>
                <Input value={shortsDurationSec} onChange={(event) => setShortsDurationSec(event.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Rights statement</Label>
              <Textarea value={shortsStatement} onChange={(event) => setShortsStatement(event.target.value)} rows={3} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shortsAttested} onChange={(event) => setShortsAttested(event.target.checked)} />
              I attest this source is authorized for short generation.
            </label>
            <Button onClick={submitAiShorts} disabled={busyAction === "shorts"}>{busyAction === "shorts" ? "Queueing..." : "Generate AI Shorts"}</Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Reddit-to-Video</CardTitle>
            <CardDescription>Generate short response drafts from Reddit thread context.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Reddit URL</Label>
              <Input value={redditUrl} onChange={(event) => setRedditUrl(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Post title (optional)</Label>
              <Input value={redditTitle} onChange={(event) => setRedditTitle(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Post context (optional)</Label>
              <Textarea value={redditBody} onChange={(event) => setRedditBody(event.target.value)} rows={3} />
            </div>
            <div className="space-y-1">
              <Label>Clip count</Label>
              <Input value={redditClipCount} onChange={(event) => setRedditClipCount(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Rights statement</Label>
              <Textarea value={redditStatement} onChange={(event) => setRedditStatement(event.target.value)} rows={3} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={redditAttested} onChange={(event) => setRedditAttested(event.target.checked)} />
              I attest this Reddit content is authorized for structural transformation.
            </label>
            <Button onClick={submitRedditFlow} disabled={busyAction === "reddit"}>{busyAction === "reddit" ? "Queueing..." : "Generate Reddit Video Drafts"}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Compliance Takedown</CardTitle>
            <CardDescription>Record takedown requests and disable attested source links.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Source URL</Label>
              <Input value={takedownUrl} onChange={(event) => setTakedownUrl(event.target.value)} placeholder="https://example.com/path" />
            </div>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea value={takedownReason} onChange={(event) => setTakedownReason(event.target.value)} rows={3} />
            </div>
            <Button variant="outline" onClick={submitTakedown} disabled={busyAction === "takedown"}>
              {busyAction === "takedown" ? "Submitting..." : "Record Takedown"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Compliance Audit</CardTitle>
          <CardDescription>Rights attestations, source links, trust events, and takedown counts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={() => void refreshAudit()}>Refresh Audit</Button>
          {audit ? (
            <>
              <div className="grid gap-2 md:grid-cols-5">
                <Badge variant="secondary">Attestations: {audit.summary.rightsAttestationCount}</Badge>
                <Badge variant="secondary">Source links: {audit.summary.sourceLinkCount}</Badge>
                <Badge variant="secondary">Trust events: {audit.summary.trustEventCount}</Badge>
                <Badge variant="secondary">Flagged: {audit.summary.flaggedCount}</Badge>
                <Badge variant="secondary">Takedowns: {audit.summary.takedownCount}</Badge>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Source type breakdown</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(audit.summary.sourceTypeBreakdown).map(([key, value]) => (
                    <Badge key={key} variant="outline">{key}: {value}</Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Recent rights attestations</p>
                {(audit.rightsAttestations ?? []).slice(0, 6).map((item) => (
                  <div className="rounded-md border p-2 text-sm" key={item.id}>
                    <p className="font-medium">{item.sourceType} - {item.sourceUrl}</p>
                    <p className="text-xs text-muted-foreground">{item.statement}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No audit data loaded yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Job Results</CardTitle>
          <CardDescription>Track generation jobs and open editable projects once complete.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.values(jobs).length === 0 ? (
            <p className="text-sm text-muted-foreground">No Phase 4 jobs yet.</p>
          ) : (
            Object.values(jobs)
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((job) => (
                <div key={job.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{job.type} - {job.id}</p>
                    <Badge variant={job.status === "ERROR" ? "outline" : "secondary"}>{job.status} ({job.progress}%)</Badge>
                  </div>
                  {job.errorMessage ? <p className="mt-1 text-xs text-destructive">{job.errorMessage}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {jobProjectLinks(job).map((project) => (
                      <Link
                        key={`${job.id}-${project.id}`}
                        href={`/projects/${project.id}`}
                        className="rounded border px-2 py-1 text-xs hover:bg-accent"
                      >
                        Open: {project.title}
                      </Link>
                    ))}
                  </div>
                </div>
              ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
