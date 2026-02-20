"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  status: "ACTIVE" | "DISABLED";
  lastUsedAt: string | null;
  createdAt: string;
};

type TranslationProfileRow = {
  id: string;
  workspaceId: string;
  name: string;
  sourceLanguage: string;
  tone: string;
  glossary: Record<string, string>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

type Artifact = {
  id: string;
  kind: string;
  storageKey: string;
  outputUrl: string;
  language: string | null;
  sourceLanguage: string | null;
  mimeType: string | null;
  durationSec: number | null;
  quality?: {
    mosEstimate?: number;
    lipSync?: {
      driftMedianMs: number;
      driftP95Ms: number;
      passed: boolean;
    };
  } | null;
};

type InternalAiJob = {
  id: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "ERROR" | "CANCELED";
  progress: number;
  errorMessage?: string | null;
  artifacts: Artifact[];
  qualitySummary?: {
    mosAverage: number | null;
    lipSyncMedianMs: number | null;
    lipSyncP95Ms: number | null;
    lipSyncPassRate: number | null;
  } | null;
};

type PublicAiJob = {
  id: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "ERROR" | "CANCELED";
  progress: number;
  errorMessage?: string | null;
  artifacts: Artifact[];
  qualitySummary?: {
    mosAverage: number | null;
    lipSyncMedianMs: number | null;
    lipSyncP95Ms: number | null;
    lipSyncPassRate: number | null;
  } | null;
};

function toLanguageList(input: string) {
  return [...new Set(input.split(",").map((code) => code.trim().toLowerCase()).filter(Boolean))];
}

function parseGlossaryInput(input: string) {
  const rows = input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const glossary: Record<string, string> = {};
  for (const row of rows) {
    const [left, ...rest] = row.split("=");
    if (!left || rest.length === 0) {
      continue;
    }
    const key = left.trim().toLowerCase();
    const value = rest.join("=").trim();
    if (!key || !value) {
      continue;
    }
    glossary[key] = value;
  }
  return glossary;
}

export function Phase5Lab() {
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [translationProfiles, setTranslationProfiles] = useState<TranslationProfileRow[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [latestSecret, setLatestSecret] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [keyName, setKeyName] = useState("Translate Sandbox Key");
  const [internalSourceUrl, setInternalSourceUrl] = useState("https://example.com/source-video.mp4");
  const [internalSourceLanguage, setInternalSourceLanguage] = useState("en");
  const [internalTargetLanguages, setInternalTargetLanguages] = useState("es,fr");
  const [internalLipDub, setInternalLipDub] = useState(false);
  const [internalProfileId, setInternalProfileId] = useState("");

  const [publicApiKey, setPublicApiKey] = useState("");
  const [publicSourceUrl, setPublicSourceUrl] = useState("https://example.com/reference-video.mp4");
  const [publicSourceLanguage, setPublicSourceLanguage] = useState("en");
  const [publicTargetLanguages, setPublicTargetLanguages] = useState("de,it");
  const [publicLipDub, setPublicLipDub] = useState(false);
  const [publicProfileId, setPublicProfileId] = useState("");

  const [profileName, setProfileName] = useState("Default Glossary");
  const [profileSourceLanguage, setProfileSourceLanguage] = useState("en");
  const [profileTone, setProfileTone] = useState("neutral");
  const [profileGlossaryInput, setProfileGlossaryInput] = useState("hookforge=HookForge\\ncaption=subtitle");
  const [profileIsDefault, setProfileIsDefault] = useState(true);

  const [internalJob, setInternalJob] = useState<InternalAiJob | null>(null);
  const [publicJob, setPublicJob] = useState<PublicAiJob | null>(null);

  const activeApiKeys = useMemo(() => apiKeys.filter((item) => item.status === "ACTIVE"), [apiKeys]);

  const refreshCredits = async () => {
    const response = await fetch("/api/credits/balance");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load credits");
    }
    setCredits(typeof payload.availableCredits === "number" ? payload.availableCredits : 0);
  };

  const refreshApiKeys = async () => {
    const response = await fetch("/api/public-api-keys");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load API keys");
    }
    setApiKeys((payload.apiKeys as ApiKeyRow[]) ?? []);
  };

  const refreshTranslationProfiles = async () => {
    const response = await fetch("/api/workspace/translation-profiles");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load translation profiles");
    }

    const profiles = (payload.profiles as TranslationProfileRow[]) ?? [];
    setTranslationProfiles(profiles);
    if (profiles.length > 0) {
      setInternalProfileId((current) => current || profiles[0].id);
      setPublicProfileId((current) => current || profiles[0].id);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await Promise.all([refreshApiKeys(), refreshCredits(), refreshTranslationProfiles()]);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load Phase 5 data");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!internalJob || (internalJob.status !== "QUEUED" && internalJob.status !== "RUNNING")) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/ai-jobs/${internalJob.id}`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to poll internal dubbing job");
        }
        const aiJob = payload.aiJob as InternalAiJob;
        setInternalJob(aiJob);
        if (aiJob.status === "DONE" || aiJob.status === "ERROR") {
          await refreshCredits();
        }
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : "Failed to poll internal job");
      }
    }, 2200);

    return () => clearInterval(timer);
  }, [internalJob]);

  useEffect(() => {
    if (!publicJob || !publicApiKey || (publicJob.status !== "QUEUED" && publicJob.status !== "RUNNING")) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/public/v1/translate/status/${publicJob.id}`, {
          headers: {
            Authorization: `Bearer ${publicApiKey}`
          }
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to poll public API job");
        }
        setPublicJob(payload.job as PublicAiJob);
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : "Failed to poll public API job");
      }
    }, 2200);

    return () => clearInterval(timer);
  }, [publicApiKey, publicJob]);

  const createApiKey = async () => {
    setBusyAction("create-key");
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/public-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create API key");
      }
      setLatestSecret(payload.secret as string);
      setPublicApiKey(payload.secret as string);
      await refreshApiKeys();
      setSuccess("API key created. Save the secret now; it is shown only once.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create API key");
    } finally {
      setBusyAction(null);
    }
  };

  const createTranslationProfile = async () => {
    setBusyAction("create-profile");
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/workspace/translation-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName,
          sourceLanguage: profileSourceLanguage,
          tone: profileTone,
          isDefault: profileIsDefault,
          glossary: parseGlossaryInput(profileGlossaryInput)
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create translation profile");
      }
      await refreshTranslationProfiles();
      if (payload.profile?.id) {
        setInternalProfileId(payload.profile.id as string);
        setPublicProfileId(payload.profile.id as string);
      }
      setSuccess("Translation profile saved.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create translation profile");
    } finally {
      setBusyAction(null);
    }
  };

  const disableApiKey = async (id: string) => {
    setBusyAction(`disable-${id}`);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/public-api-keys/${id}/disable`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to disable API key");
      }
      await refreshApiKeys();
      setSuccess(`API key ${payload.apiKey?.keyPrefix ?? ""} disabled.`);
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : "Failed to disable API key");
    } finally {
      setBusyAction(null);
    }
  };

  const submitInternalDubbing = async () => {
    setBusyAction("internal-dub");
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/dubbing/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: internalSourceUrl,
          sourceLanguage: internalSourceLanguage,
          targetLanguages: toLanguageList(internalTargetLanguages),
          lipDub: internalLipDub,
          translationProfileId: internalProfileId || undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Internal dubbing request failed");
      }
      setInternalJob({
        id: payload.jobId as string,
        type: internalLipDub ? "LIPSYNC" : "DUBBING",
        status: "QUEUED",
        progress: 0,
        artifacts: []
      });
      setSuccess(`Internal dubbing queued. Credits reserved: ${payload.creditEstimate}.`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Internal dubbing request failed");
    } finally {
      setBusyAction(null);
    }
  };

  const submitPublicTranslate = async () => {
    setBusyAction("public-dub");
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/public/v1/translate/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${publicApiKey}`
        },
        body: JSON.stringify({
          sourceMediaUrl: publicSourceUrl,
          sourceLanguage: publicSourceLanguage,
          targetLanguages: toLanguageList(publicTargetLanguages),
          lipDub: publicLipDub,
          translationProfileId: publicProfileId || undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Public translate request failed");
      }
      setPublicJob({
        id: payload.jobId as string,
        type: publicLipDub ? "LIPSYNC" : "DUBBING",
        status: "QUEUED",
        progress: 0,
        artifacts: []
      });
      setSuccess(`Public API job queued. Credits reserved: ${payload.creditEstimate}.`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Public API job request failed");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
          Localization Lab (Phase 5)
        </h1>
        <p className="text-sm text-muted-foreground">
          Dubbing/lipdub jobs, public translation API, and API key + credit controls.
        </p>
      </div>

      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="pt-6 text-sm text-amber-900">
          Upload or submit only content you own or are licensed to process. HookForge never authorizes copyright circumvention.
        </CardContent>
      </Card>

      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {success ? <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700">{success}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspace API Keys</CardTitle>
            <CardDescription>Create/revoke public API keys used by `/api/public/v1/translate/*`.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Key name</Label>
                <Input value={keyName} onChange={(event) => setKeyName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Available credits</Label>
                <Input value={credits ?? 0} disabled />
              </div>
            </div>
            <Button onClick={createApiKey} disabled={busyAction === "create-key"}>
              {busyAction === "create-key" ? "Creating..." : "Create API Key"}
            </Button>
            {latestSecret ? (
              <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">New key (shown once)</p>
                <Textarea rows={2} value={latestSecret} readOnly />
              </div>
            ) : null}
            <div className="space-y-2">
              {apiKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No API keys yet.</p>
              ) : (
                apiKeys.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.keyPrefix}... | Last used: {item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : "Never"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={item.status === "ACTIVE" ? "default" : "secondary"}>{item.status}</Badge>
                      {item.status === "ACTIVE" ? (
                        <Button size="sm" variant="outline" onClick={() => void disableApiKey(item.id)} disabled={busyAction === `disable-${item.id}`}>
                          Disable
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">Active keys: {activeApiKeys.length}</p>

            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Translation Profiles</p>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Profile name</Label>
                  <Input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Source language</Label>
                  <Input value={profileSourceLanguage} onChange={(event) => setProfileSourceLanguage(event.target.value)} />
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Tone</Label>
                  <Input value={profileTone} onChange={(event) => setProfileTone(event.target.value)} />
                </div>
                <label className="mt-7 flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={profileIsDefault} onChange={(event) => setProfileIsDefault(event.target.checked)} />
                  Set as default
                </label>
              </div>
              <div className="space-y-1">
                <Label>Glossary (one per line: key=value)</Label>
                <Textarea rows={3} value={profileGlossaryInput} onChange={(event) => setProfileGlossaryInput(event.target.value)} />
              </div>
              <Button size="sm" variant="outline" onClick={createTranslationProfile} disabled={busyAction === "create-profile"}>
                {busyAction === "create-profile" ? "Saving..." : "Save Translation Profile"}
              </Button>
              <div className="space-y-1 text-xs text-muted-foreground">
                {translationProfiles.length === 0 ? (
                  <p>No profiles yet.</p>
                ) : (
                  translationProfiles.map((profile) => (
                    <p key={profile.id}>
                      {profile.name} ({profile.sourceLanguage}) {profile.isDefault ? "- default" : ""}
                    </p>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Internal Dubbing Job</CardTitle>
            <CardDescription>Queue multi-language dubbing/lipdub for your workspace media workflow.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Source URL (rights-attested reference)</Label>
              <Input value={internalSourceUrl} onChange={(event) => setInternalSourceUrl(event.target.value)} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Source language</Label>
                <Input value={internalSourceLanguage} onChange={(event) => setInternalSourceLanguage(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Target languages (comma-separated)</Label>
                <Input value={internalTargetLanguages} onChange={(event) => setInternalTargetLanguages(event.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Translation profile</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={internalProfileId}
                onChange={(event) => setInternalProfileId(event.target.value)}
              >
                <option value="">None</option>
                {translationProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name} ({profile.sourceLanguage})
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={internalLipDub} onChange={(event) => setInternalLipDub(event.target.checked)} />
              Enable lipdub pipeline
            </label>
            <Button onClick={submitInternalDubbing} disabled={busyAction === "internal-dub"}>
              {busyAction === "internal-dub" ? "Queueing..." : "Queue Internal Dubbing"}
            </Button>
            {internalJob ? (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  Job {internalJob.id} - {internalJob.status} ({internalJob.progress}%)
                </p>
                {internalJob.qualitySummary ? (
                  <p className="text-xs text-muted-foreground">
                    MOS avg: {internalJob.qualitySummary.mosAverage ?? "-"} | Lip-sync median/p95:{" "}
                    {internalJob.qualitySummary.lipSyncMedianMs ?? "-"} / {internalJob.qualitySummary.lipSyncP95Ms ?? "-"} ms
                  </p>
                ) : null}
                {internalJob.errorMessage ? <p className="text-destructive">{internalJob.errorMessage}</p> : null}
                {internalJob.artifacts.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {internalJob.artifacts.map((artifact) => (
                      <a key={artifact.id} href={artifact.outputUrl} className="block text-primary underline" target="_blank" rel="noreferrer">
                        {artifact.language ?? "track"} - {artifact.kind}
                        {artifact.quality?.mosEstimate ? ` (MOS ${artifact.quality.mosEstimate.toFixed(2)})` : ""}
                        {artifact.quality?.lipSync ? ` [lip-sync ${artifact.quality.lipSync.driftMedianMs}/${artifact.quality.lipSync.driftP95Ms}ms]` : ""}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Public API Sandbox</CardTitle>
          <CardDescription>Smoke-test `/api/public/v1/translate/submit` and status polling with a live key.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>API key secret</Label>
            <Input value={publicApiKey} onChange={(event) => setPublicApiKey(event.target.value)} placeholder="hfpk_..." />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1 md:col-span-2">
              <Label>Source media URL</Label>
              <Input value={publicSourceUrl} onChange={(event) => setPublicSourceUrl(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Source language</Label>
              <Input value={publicSourceLanguage} onChange={(event) => setPublicSourceLanguage(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Target languages (comma-separated)</Label>
            <Input value={publicTargetLanguages} onChange={(event) => setPublicTargetLanguages(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Translation profile</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={publicProfileId}
              onChange={(event) => setPublicProfileId(event.target.value)}
            >
              <option value="">None</option>
              {translationProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.sourceLanguage})
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={publicLipDub} onChange={(event) => setPublicLipDub(event.target.checked)} />
            Enable lipdub pipeline
          </label>
          <Button onClick={submitPublicTranslate} disabled={busyAction === "public-dub" || !publicApiKey}>
            {busyAction === "public-dub" ? "Queueing..." : "Submit Public API Job"}
          </Button>
          {publicJob ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">
                  Public Job {publicJob.id} - {publicJob.status} ({publicJob.progress}%)
                </p>
                {publicJob.qualitySummary ? (
                  <p className="text-xs text-muted-foreground">
                    MOS avg: {publicJob.qualitySummary.mosAverage ?? "-"} | Lip-sync median/p95:{" "}
                    {publicJob.qualitySummary.lipSyncMedianMs ?? "-"} / {publicJob.qualitySummary.lipSyncP95Ms ?? "-"} ms
                  </p>
                ) : null}
                {publicJob.errorMessage ? <p className="text-destructive">{publicJob.errorMessage}</p> : null}
              {publicJob.artifacts.length > 0 ? (
                <div className="mt-2 space-y-1">
                    {publicJob.artifacts.map((artifact) => (
                      <a key={artifact.id} href={artifact.outputUrl} className="block text-primary underline" target="_blank" rel="noreferrer">
                        {artifact.language ?? "track"} - {artifact.kind}
                        {artifact.quality?.mosEstimate ? ` (MOS ${artifact.quality.mosEstimate.toFixed(2)})` : ""}
                        {artifact.quality?.lipSync ? ` [lip-sync ${artifact.quality.lipSync.driftMedianMs}/${artifact.quality.lipSync.driftP95Ms}ms]` : ""}
                      </a>
                    ))}
                  </div>
                ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
