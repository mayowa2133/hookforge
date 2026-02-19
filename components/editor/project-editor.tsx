"use client";

import { useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Player } from "@remotion/player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { PhaseTwoPanel } from "@/components/editor/phase-two-panel";
import { useEditorStore, type EditorAsset, type EditorRenderJob } from "@/components/editor/use-editor-store";
import { type TemplateSlotSchemaJsonType } from "@/lib/template-schema";
import { GreenScreenCommentatorTemplate } from "@/remotion/templates/green-screen-commentator";
import { TweetCommentPopupReplyTemplate } from "@/remotion/templates/tweet-comment-popup-reply";
import { ThreeBeatMontageIntroTemplate } from "@/remotion/templates/three-beat-montage-intro-main-talk";
import { SplitScreenReactionTemplate } from "@/remotion/templates/split-screen-reaction";
import { FakeFaceTimeIncomingCallTemplate } from "@/remotion/templates/fake-facetime-incoming-call";
import type { RemotionTemplateProps } from "@/remotion/types";
import type { TimelineClip, TimelineOperation, TimelineState, TimelineTrack, TimelineTrackKind } from "@/lib/timeline-types";

type ProjectEditorProps = {
  initial: {
    id: string;
    title: string;
    status: "DRAFT" | "READY" | "RENDERING" | "DONE" | "ERROR";
    config: Record<string, string | number | boolean>;
    template: {
      slug: string;
      name: string;
      slotSchema: TemplateSlotSchemaJsonType;
    };
    assets: EditorAsset[];
    currentRenderJob: EditorRenderJob | null;
  };
};

const compositionBySlug = {
  "green-screen-commentator": GreenScreenCommentatorTemplate,
  "tweet-comment-popup-reply": TweetCommentPopupReplyTemplate,
  "three-beat-montage-intro-main-talk": ThreeBeatMontageIntroTemplate,
  "split-screen-reaction": SplitScreenReactionTemplate,
  "fake-facetime-incoming-call": FakeFaceTimeIncomingCallTemplate
} as const;

function allowedAcceptMap(kinds: string[]) {
  const accepts: Record<string, string[]> = {};
  if (kinds.includes("VIDEO")) accepts["video/*"] = [];
  if (kinds.includes("IMAGE")) accepts["image/*"] = [];
  if (kinds.includes("AUDIO")) accepts["audio/*"] = [];
  return accepts;
}

function estimateDurationInFrames(
  slug: string,
  config: Record<string, string | number | boolean>,
  assets: Record<string, EditorAsset>
) {
  const fps = 30;
  const safeMain = Math.max(
    4,
    Number(assets.main?.durationSec ?? assets.foreground?.durationSec ?? assets.top?.durationSec ?? 6)
  );

  if (slug === "three-beat-montage-intro-main-talk") {
    return Math.ceil((safeMain + Number(config.beatDurationSec ?? 0.5) * 3) * fps);
  }

  if (slug === "fake-facetime-incoming-call") {
    return Math.ceil((safeMain + Number(config.ringDurationSec ?? 2)) * fps);
  }

  if (slug === "split-screen-reaction") {
    const top = Number(assets.top?.durationSec ?? safeMain);
    const bottom = Number(assets.bottom?.durationSec ?? safeMain);
    return Math.ceil(Math.max(top, bottom) * fps);
  }

  return Math.ceil(safeMain * fps);
}

function formatMs(ms: number) {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const remainderMs = safeMs % 1000;
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${Math.floor(remainderMs / 10)
    .toString()
    .padStart(2, "0")}`;
}

const exportPresetOptions = [
  { value: "tiktok_9x16", label: "TikTok 9:16" },
  { value: "reels_9x16", label: "Reels 9:16" },
  { value: "youtube_shorts_9x16", label: "YouTube Shorts 9:16" },
  { value: "custom", label: "Custom" }
] as const;

const bundledAudioOptions = [
  { slotKey: "library:sfx-boom", label: "SFX Boom" },
  { slotKey: "library:sfx-ring", label: "SFX Ring" },
  { slotKey: "library:sfx-notify", label: "SFX Notify" },
  { slotKey: "library:music-bed", label: "Music Bed" }
] as const;

function clipDurationMs(clip: TimelineClip) {
  return Math.max(120, clip.timelineOutMs - clip.timelineInMs);
}

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getEffectByType(clip: TimelineClip, effectType: string) {
  return clip.effects.find((effect) => effect.type === effectType);
}

function readTransformNumber(clip: TimelineClip, key: string, fallback: number) {
  const transform = getEffectByType(clip, "transform");
  const value = transform?.config[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function maxTimelineMs(state: TimelineState | null) {
  if (!state) {
    return 0;
  }

  let maxMs = 0;
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      maxMs = Math.max(maxMs, clip.timelineOutMs);
    }
  }
  return maxMs;
}

type UploadSlotCardProps = {
  projectId: string;
  slot: TemplateSlotSchemaJsonType["slots"][number];
  asset: EditorAsset | undefined;
  onAssetRegistered: (asset: EditorAsset, projectStatus: "DRAFT" | "READY" | "RENDERING" | "DONE" | "ERROR") => void;
};

function UploadSlotCard({ projectId, slot, asset, onAssetRegistered }: UploadSlotCardProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const presignResponse = await fetch(`/api/projects/${projectId}/assets/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotKey: slot.key,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size
        })
      });
      const presignPayload = await presignResponse.json();
      if (!presignResponse.ok) {
        throw new Error(presignPayload.error ?? "Could not get upload URL");
      }

      const uploadResponse = await fetch(presignPayload.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream"
        },
        body: file
      });
      if (!uploadResponse.ok) {
        throw new Error("Upload to storage failed");
      }

      const registerResponse = await fetch(`/api/projects/${projectId}/assets/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotKey: slot.key,
          storageKey: presignPayload.storageKey,
          mimeType: file.type || "application/octet-stream"
        })
      });
      const registerPayload = await registerResponse.json();

      if (!registerResponse.ok) {
        throw new Error(registerPayload.error ?? "Failed to register uploaded file");
      }

      onAssetRegistered(registerPayload.asset, registerPayload.project.status);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    onDrop,
    accept: allowedAcceptMap(slot.kinds)
  });

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">
          {slot.label} <span className="text-xs text-muted-foreground">({slot.key})</span>
        </p>
        <Badge variant={asset ? "secondary" : "outline"}>{asset ? "Uploaded" : "Missing"}</Badge>
      </div>

      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-md border border-dashed p-3 text-xs transition ${
          isDragActive ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
        }`}
      >
        <input {...getInputProps()} />
        <p>{uploading ? "Uploading..." : `Drag & drop or click to upload (${slot.kinds.join(", ")})`}</p>
      </div>

      {asset ? (
        <div className="overflow-hidden rounded-md border">
          {asset.kind === "IMAGE" ? (
            <img src={asset.signedUrl} alt={slot.label} className="h-28 w-full object-cover" />
          ) : asset.kind === "VIDEO" ? (
            <video src={asset.signedUrl} className="h-28 w-full object-cover" muted playsInline controls />
          ) : (
            <audio src={asset.signedUrl} controls className="w-full" />
          )}
        </div>
      ) : null}

      {slot.helpText ? <p className="text-xs text-muted-foreground">{slot.helpText}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ProjectEditor({ initial }: ProjectEditorProps) {
  const {
    projectId,
    projectTitle,
    projectStatus,
    templateSlug,
    templateName,
    slotSchema,
    config,
    assets,
    currentRenderJob,
    hydrate,
    setAsset,
    setConfigValue,
    setProjectStatus,
    setCurrentRenderJob
  } = useEditorStore();

  const [error, setError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [startingRender, setStartingRender] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineApplying, setTimelineApplying] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [timelineState, setTimelineState] = useState<TimelineState | null>(null);
  const [newTrackName, setNewTrackName] = useState("Video Track");
  const [newTrackKind, setNewTrackKind] = useState<TimelineTrackKind>("VIDEO");
  const [clipPickerTrackId, setClipPickerTrackId] = useState<string>("");
  const [clipPickerAssetId, setClipPickerAssetId] = useState<string>("");
  const [clipPickerStartMs, setClipPickerStartMs] = useState("0");
  const [clipPickerDurationMs, setClipPickerDurationMs] = useState("1500");
  const [clipPickerLabel, setClipPickerLabel] = useState("Overlay");

  useEffect(() => {
    hydrate({
      projectId: initial.id,
      projectTitle: initial.title,
      projectStatus: initial.status,
      templateSlug: initial.template.slug,
      templateName: initial.template.name,
      slotSchema: initial.template.slotSchema,
      config: initial.config,
      assets: initial.assets,
      currentRenderJob: initial.currentRenderJob
    });
  }, [hydrate, initial]);

  useEffect(() => {
    if (!currentRenderJob) return;
    if (currentRenderJob.status !== "QUEUED" && currentRenderJob.status !== "RUNNING") return;

    const poll = setInterval(async () => {
      const response = await fetch(`/api/render-jobs/${currentRenderJob.id}`);
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Failed to fetch render status");
        return;
      }

      const updatedJob = payload.renderJob as EditorRenderJob;
      setCurrentRenderJob(updatedJob);

      if (updatedJob.status === "DONE") {
        setProjectStatus("DONE");
      }
      if (updatedJob.status === "ERROR") {
        setProjectStatus("ERROR");
      }
    }, 2200);

    return () => clearInterval(poll);
  }, [currentRenderJob, setCurrentRenderJob, setProjectStatus]);

  const fetchTimeline = async () => {
    if (!projectId) return;
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/timeline`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to fetch timeline");
      }
      setTimelineState(payload.timeline as TimelineState);
    } catch (timelineFetchError) {
      setTimelineError(timelineFetchError instanceof Error ? timelineFetchError.message : "Failed to fetch timeline");
    } finally {
      setTimelineLoading(false);
    }
  };

  const applyTimelinePatch = async (operations: TimelineOperation[]) => {
    if (!projectId || operations.length === 0) return;
    setTimelineApplying(true);
    setTimelineError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/timeline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ operations })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to apply timeline operation");
      }
      setTimelineState(payload.timeline as TimelineState);
    } catch (timelinePatchError) {
      setTimelineError(timelinePatchError instanceof Error ? timelinePatchError.message : "Failed to apply timeline operation");
    } finally {
      setTimelineApplying(false);
    }
  };

  useEffect(() => {
    if (!projectId) return;
    void fetchTimeline();
  }, [projectId]);

  const missingRequiredSlots = useMemo(
    () => slotSchema.slots.filter((slot) => slot.required && !assets[slot.key]).map((slot) => slot.key),
    [assets, slotSchema.slots]
  );

  const durationInFrames = useMemo(() => {
    const templateEstimated = estimateDurationInFrames(templateSlug, config, assets);
    const timelineEstimated = Math.ceil((maxTimelineMs(timelineState) / 1000) * 30);
    return Math.max(60, templateEstimated, timelineEstimated);
  }, [templateSlug, config, assets, timelineState]);

  const previewProps: RemotionTemplateProps = useMemo(
    () => ({
      assets: Object.fromEntries(
        Object.entries(assets).map(([slotKey, asset]) => [
          slotKey,
          {
            id: asset.id,
            slotKey,
            src: asset.signedUrl,
            kind: asset.kind,
            durationSec: asset.durationSec,
            width: asset.width,
            height: asset.height,
            mimeType: asset.mimeType
          }
        ])
      ),
      assetManifest: Object.fromEntries(
        Object.values(assets).map((asset) => [
          asset.id,
          {
            id: asset.id,
            slotKey: asset.slotKey,
            src: asset.signedUrl,
            kind: asset.kind,
            durationSec: asset.durationSec,
            width: asset.width,
            height: asset.height,
            mimeType: asset.mimeType
          }
        ])
      ),
      timelineState,
      config,
      durationInFrames,
      fps: 30
    }),
    [assets, config, durationInFrames, timelineState]
  );

  const PreviewComponent =
    compositionBySlug[templateSlug as keyof typeof compositionBySlug] ?? GreenScreenCommentatorTemplate;

  const orderedTracks = useMemo(
    () => (timelineState ? [...timelineState.tracks].sort((a, b) => a.order - b.order) : []),
    [timelineState]
  );

  const availableAssets = useMemo(() => Object.values(assets), [assets]);
  const availableAssetsById = useMemo(
    () => Object.fromEntries(availableAssets.map((asset) => [asset.id, asset])),
    [availableAssets]
  );
  const audioTracks = useMemo(() => orderedTracks.filter((track) => track.kind === "AUDIO"), [orderedTracks]);
  const captionTracks = useMemo(() => orderedTracks.filter((track) => track.kind === "CAPTION"), [orderedTracks]);
  const videoTracks = useMemo(() => orderedTracks.filter((track) => track.kind === "VIDEO"), [orderedTracks]);
  const firstTrackId = orderedTracks[0]?.id ?? "";
  const selectedClipAsset = clipPickerAssetId ? availableAssetsById[clipPickerAssetId] : undefined;

  useEffect(() => {
    if (!clipPickerTrackId && firstTrackId) {
      setClipPickerTrackId(firstTrackId);
    }
  }, [clipPickerTrackId, firstTrackId]);

  useEffect(() => {
    if (!clipPickerAssetId && availableAssets.length > 0) {
      setClipPickerAssetId(availableAssets[0].id);
      setClipPickerLabel(availableAssets[0].slotKey);
      setClipPickerDurationMs(String(Math.max(120, Math.floor((availableAssets[0].durationSec ?? 5) * 1000))));
    }
  }, [availableAssets, clipPickerAssetId]);

  const saveConfig = async () => {
    setSavingConfig(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save controls");
      }
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save controls");
      return false;
    } finally {
      setSavingConfig(false);
    }
  };

  const startRender = async () => {
    setStartingRender(true);
    setError(null);

    try {
      const saved = await saveConfig();
      if (!saved) {
        return;
      }

      const response = await fetch(`/api/projects/${projectId}/render`, {
        method: "POST"
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Render request failed");
      }

      setCurrentRenderJob({
        ...payload.renderJob,
        outputUrl: null
      });
      setProjectStatus("RENDERING");
    } catch (renderError) {
      setError(renderError instanceof Error ? renderError.message : "Render request failed");
    } finally {
      setStartingRender(false);
    }
  };

  const createTrack = async () => {
    const normalizedName = newTrackName.trim();
    if (!normalizedName) {
      setTimelineError("Track name is required");
      return;
    }
    await applyTimelinePatch([{ op: "create_track", kind: newTrackKind, name: normalizedName }]);
    setNewTrackName(newTrackKind === "AUDIO" ? "Audio Track" : newTrackKind === "CAPTION" ? "Caption Track" : "Video Track");
  };

  const addClipFromPicker = async () => {
    if (!clipPickerTrackId) {
      setTimelineError("Select a track before adding a clip.");
      return;
    }
    const asset = clipPickerAssetId ? availableAssetsById[clipPickerAssetId] : undefined;
    const startMs = Math.max(0, parseNumber(clipPickerStartMs, 0));
    const durationMs = Math.max(120, parseNumber(clipPickerDurationMs, asset ? Math.floor((asset.durationSec ?? 5) * 1000) : 1500));
    await applyTimelinePatch([
      {
        op: "add_clip",
        trackId: clipPickerTrackId,
        assetId: asset?.id,
        slotKey: asset?.slotKey,
        label: clipPickerLabel.slice(0, 160),
        timelineInMs: startMs,
        durationMs
      }
    ]);
  };

  const addBundledAudioToTrack = async (trackId: string, slotKey: string, label: string) => {
    await applyTimelinePatch([
      {
        op: "add_clip",
        trackId,
        slotKey,
        label,
        timelineInMs: 0,
        durationMs: 1600
      }
    ]);
  };

  const ensurePhaseAudioTracks = async () => {
    const existingNames = new Set(orderedTracks.map((track) => track.name.toLowerCase()));
    const operations: TimelineOperation[] = [];
    if (!existingNames.has("voiceover track")) {
      operations.push({ op: "create_track", kind: "AUDIO", name: "Voiceover Track" });
    }
    if (!existingNames.has("music track")) {
      operations.push({ op: "create_track", kind: "AUDIO", name: "Music Track" });
    }
    if (!existingNames.has("sfx track")) {
      operations.push({ op: "create_track", kind: "AUDIO", name: "SFX Track" });
    }
    if (!existingNames.has("overlay track")) {
      operations.push({ op: "create_track", kind: "VIDEO", name: "Overlay Track" });
    }
    if (!existingNames.has("caption track")) {
      operations.push({ op: "create_track", kind: "CAPTION", name: "Caption Track" });
    }

    if (operations.length === 0) {
      return;
    }
    await applyTimelinePatch(operations);
  };

  const addCaptionClip = async (trackId: string) => {
    await applyTimelinePatch([
      {
        op: "add_clip",
        trackId,
        label: "Add your headline caption",
        timelineInMs: 200,
        durationMs: 1600
      }
    ]);
  };

  const upsertClipEffect = async (trackId: string, clip: TimelineClip, effectType: string, nextConfig: Record<string, unknown>) => {
    const existing = clip.effects.find((effect) => effect.type === effectType);
    const mergedConfig = {
      ...(existing?.config ?? {}),
      ...nextConfig
    };
    await applyTimelinePatch([
      {
        op: "upsert_effect",
        trackId,
        clipId: clip.id,
        effectType,
        config: mergedConfig
      }
    ]);
  };

  const addTransformKeyframe = async (trackId: string, clip: TimelineClip, property: string, value: number) => {
    const transform = clip.effects.find((effect) => effect.type === "transform");
    if (!transform) {
      setTimelineError("Add a transform effect first, then keyframe it.");
      return;
    }

    await applyTimelinePatch([
      {
        op: "set_keyframe",
        trackId,
        clipId: clip.id,
        effectId: transform.id,
        property,
        timeMs: Math.floor(clipDurationMs(clip) / 2),
        value,
        easing: "ease-in-out"
      }
    ]);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <p className="font-semibold text-primary">Compliance and rights notice</p>
        <p className="mt-1 text-muted-foreground">
          Upload only content you own or have permission to use. HookForge templates copy structural pacing, not source visuals.
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr_330px]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{projectTitle}</CardTitle>
            <CardDescription>{templateName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {slotSchema.slots.map((slot) => (
              <UploadSlotCard
                key={slot.key}
                projectId={projectId}
                slot={slot}
                asset={assets[slot.key]}
                onAssetRegistered={(asset, status) => {
                  setAsset(asset);
                  setProjectStatus(status);
                }}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live Preview</CardTitle>
            <CardDescription>WYSIWYG Remotion Player preview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="mx-auto max-w-[360px] overflow-hidden rounded-lg border">
              <Player
                component={PreviewComponent}
                durationInFrames={durationInFrames}
                compositionHeight={1920}
                compositionWidth={1080}
                fps={30}
                controls
                loop
                inputProps={previewProps}
                style={{ width: "100%", aspectRatio: "9 / 16" }}
              />
            </div>
            <p className="text-xs text-muted-foreground">Duration estimate: {(durationInFrames / 30).toFixed(1)}s</p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Controls</CardTitle>
              <CardDescription>Template-specific settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {slotSchema.controls.map((control) => {
                const value = config[control.key];

                if (control.type === "boolean") {
                  return (
                    <div key={control.key} className="space-y-1">
                      <label className="flex items-center justify-between gap-2 text-sm">
                        <span>{control.label}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(event) => setConfigValue(control.key, event.target.checked)}
                        />
                      </label>
                      {control.helpText ? <p className="text-xs text-muted-foreground">{control.helpText}</p> : null}
                    </div>
                  );
                }

                if (control.type === "number") {
                  const numericValue = Number(value ?? control.defaultValue);
                  return (
                    <div key={control.key} className="space-y-1">
                      <Label>{control.label}</Label>
                      {typeof control.min === "number" && typeof control.max === "number" ? (
                        <input
                          className="w-full"
                          type="range"
                          min={control.min}
                          max={control.max}
                          step={control.step ?? 0.1}
                          value={numericValue}
                          onChange={(event) => setConfigValue(control.key, Number(event.target.value))}
                        />
                      ) : null}
                      <Input
                        type="number"
                        min={control.min}
                        max={control.max}
                        step={control.step ?? 0.1}
                        value={numericValue}
                        onChange={(event) => setConfigValue(control.key, Number(event.target.value))}
                      />
                      {control.helpText ? <p className="text-xs text-muted-foreground">{control.helpText}</p> : null}
                    </div>
                  );
                }

                if (control.type === "select") {
                  return (
                    <div key={control.key} className="space-y-1">
                      <Label>{control.label}</Label>
                      <select
                        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                        value={String(value ?? control.defaultValue)}
                        onChange={(event) => setConfigValue(control.key, event.target.value)}
                      >
                        {(control.options ?? []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {control.helpText ? <p className="text-xs text-muted-foreground">{control.helpText}</p> : null}
                    </div>
                  );
                }

                return (
                  <div key={control.key} className="space-y-1">
                    <Label>{control.label}</Label>
                    <Input
                      value={String(value ?? control.defaultValue)}
                      onChange={(event) => setConfigValue(control.key, event.target.value)}
                    />
                    {control.helpText ? <p className="text-xs text-muted-foreground">{control.helpText}</p> : null}
                  </div>
                );
              })}

              <Button variant="outline" className="w-full" onClick={saveConfig} disabled={savingConfig}>
                {savingConfig ? "Saving..." : "Save controls"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline (Phase 1)</CardTitle>
              <CardDescription>Manual timeline editing, overlays, multi-track audio, and version history</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                <Input value={newTrackName} onChange={(event) => setNewTrackName(event.target.value)} placeholder="Track name" />
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={newTrackKind}
                  onChange={(event) => setNewTrackKind(event.target.value as TimelineTrackKind)}
                >
                  <option value="VIDEO">VIDEO</option>
                  <option value="AUDIO">AUDIO</option>
                  <option value="CAPTION">CAPTION</option>
                </select>
                <Button variant="outline" onClick={createTrack} disabled={timelineApplying}>
                  Add track
                </Button>
              </div>

              <div className="grid gap-2 sm:grid-cols-[auto_auto]">
                <Button variant="outline" onClick={() => void ensurePhaseAudioTracks()} disabled={timelineApplying}>
                  Scaffold Voiceover + Music + SFX + Overlay Tracks
                </Button>
                <Button variant="outline" onClick={() => void fetchTimeline()} disabled={timelineLoading || timelineApplying}>
                  Refresh timeline
                </Button>
              </div>

              <div className="rounded-lg border p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add Clip</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Track</Label>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={clipPickerTrackId}
                      onChange={(event) => setClipPickerTrackId(event.target.value)}
                    >
                      <option value="">Select track</option>
                      {orderedTracks.map((track) => (
                        <option key={track.id} value={track.id}>
                          {track.name} ({track.kind})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Uploaded Asset</Label>
                    <select
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      value={clipPickerAssetId}
                      onChange={(event) => {
                        const nextAssetId = event.target.value;
                        setClipPickerAssetId(nextAssetId);
                        const nextAsset = availableAssetsById[nextAssetId];
                        if (nextAsset) {
                          setClipPickerLabel(nextAsset.slotKey);
                          setClipPickerDurationMs(String(Math.max(120, Math.floor((nextAsset.durationSec ?? 5) * 1000))));
                        }
                      }}
                    >
                      <option value="">No asset</option>
                      {availableAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.slotKey} ({asset.kind})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                  <Input
                    type="number"
                    value={clipPickerStartMs}
                    onChange={(event) => setClipPickerStartMs(event.target.value)}
                    placeholder="Start ms"
                  />
                  <Input
                    type="number"
                    value={clipPickerDurationMs}
                    onChange={(event) => setClipPickerDurationMs(event.target.value)}
                    placeholder="Duration ms"
                  />
                  <Input
                    value={clipPickerLabel}
                    onChange={(event) => setClipPickerLabel(event.target.value)}
                    placeholder="Clip label"
                  />
                  <Button variant="outline" onClick={() => void addClipFromPicker()} disabled={timelineApplying || !clipPickerTrackId}>
                    Add
                  </Button>
                </div>
                {selectedClipAsset ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Selected asset duration: {selectedClipAsset.durationSec?.toFixed(2) ?? "unknown"}s
                  </p>
                ) : null}
              </div>

              {audioTracks.length > 0 ? (
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bundled Audio Library</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {audioTracks.map((track) => (
                      <div key={track.id} className="space-y-2 rounded border p-2">
                        <p className="text-xs font-medium">{track.name}</p>
                        <div className="flex flex-wrap gap-1">
                          {bundledAudioOptions.map((option) => (
                            <Button
                              key={`${track.id}-${option.slotKey}`}
                              variant="outline"
                              size="sm"
                              disabled={timelineApplying}
                              onClick={() => void addBundledAudioToTrack(track.id, option.slotKey, option.label)}
                            >
                              {option.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={timelineState?.exportPreset ?? "tiktok_9x16"}
                  onChange={(event) =>
                    void applyTimelinePatch([
                      {
                        op: "set_export_preset",
                        preset: event.target.value as "tiktok_9x16" | "reels_9x16" | "youtube_shorts_9x16" | "custom"
                      }
                    ])
                  }
                  disabled={!timelineState || timelineApplying}
                >
                  {exportPresetOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  onClick={() =>
                    void applyTimelinePatch([
                      {
                        op: "set_export_preset",
                        preset: "custom",
                        width: 1080,
                        height: 1920
                      }
                    ])
                  }
                  disabled={timelineApplying}
                >
                  1080x1920
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                {timelineState
                  ? `Revision ${timelineState.version} • ${timelineState.resolution.width}x${timelineState.resolution.height} @ ${timelineState.fps}fps`
                  : "Timeline not loaded yet."}
              </p>

              {timelineLoading ? <p className="text-xs text-muted-foreground">Loading timeline...</p> : null}
              {timelineError ? <p className="text-xs text-destructive">{timelineError}</p> : null}

              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {orderedTracks.map((track, trackIndex) => (
                  <div key={track.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">
                          {track.name} <span className="text-xs text-muted-foreground">({track.kind})</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Track order: {track.order} • Clips: {track.clips.length}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={timelineApplying || trackIndex === 0}
                          onClick={() => void applyTimelinePatch([{ op: "reorder_track", trackId: track.id, order: track.order - 1 }])}
                        >
                          Up
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={timelineApplying || trackIndex === orderedTracks.length - 1}
                          onClick={() => void applyTimelinePatch([{ op: "reorder_track", trackId: track.id, order: track.order + 1 }])}
                        >
                          Down
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={track.volume}
                        onChange={(event) =>
                          void applyTimelinePatch([
                            { op: "set_track_audio", trackId: track.id, volume: Number(event.target.value) }
                          ])
                        }
                        disabled={timelineApplying}
                      />
                      <Label className="text-xs">Vol {track.volume.toFixed(2)}</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={timelineApplying}
                        onClick={() =>
                          void applyTimelinePatch([
                            {
                              op: "set_track_audio",
                              trackId: track.id,
                              volume: 1
                            }
                          ])
                        }
                      >
                        Reset
                      </Button>
                      <label className="text-xs">
                        <input
                          type="checkbox"
                          checked={track.muted}
                          disabled={timelineApplying}
                          onChange={(event) =>
                            void applyTimelinePatch([
                              { op: "set_track_audio", trackId: track.id, muted: event.target.checked }
                            ])
                          }
                        />{" "}
                        Muted
                      </label>
                    </div>

                    {track.kind === "CAPTION" ? (
                      <Button variant="outline" size="sm" onClick={() => void addCaptionClip(track.id)} disabled={timelineApplying}>
                        Add caption clip
                      </Button>
                    ) : null}

                    <div className="space-y-2">
                      {track.clips.map((clip) => (
                        <div key={clip.id} className="space-y-2 rounded-md border bg-muted/20 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium">
                              {clip.label ?? clip.slotKey ?? clip.assetId ?? clip.id}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatMs(clip.timelineInMs)} - {formatMs(clip.timelineOutMs)}
                            </p>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                            <Input
                              defaultValue={clip.label ?? clip.slotKey ?? "Clip"}
                              onBlur={(event) => {
                                const nextLabel = event.target.value.trim();
                                if (!nextLabel || nextLabel === (clip.label ?? clip.slotKey ?? "Clip")) return;
                                void applyTimelinePatch([
                                  {
                                    op: "set_clip_label",
                                    trackId: track.id,
                                    clipId: clip.id,
                                    label: nextLabel
                                  }
                                ]);
                              }}
                            />
                            <Input
                              type="number"
                              defaultValue={String(clip.timelineInMs)}
                              onBlur={(event) =>
                                void applyTimelinePatch([
                                  {
                                    op: "set_clip_timing",
                                    trackId: track.id,
                                    clipId: clip.id,
                                    timelineInMs: Math.max(0, parseNumber(event.target.value, clip.timelineInMs)),
                                    durationMs: clipDurationMs(clip)
                                  }
                                ])
                              }
                            />
                            <Input
                              type="number"
                              defaultValue={String(clipDurationMs(clip))}
                              onBlur={(event) =>
                                void applyTimelinePatch([
                                  {
                                    op: "set_clip_timing",
                                    trackId: track.id,
                                    clipId: clip.id,
                                    timelineInMs: clip.timelineInMs,
                                    durationMs: Math.max(120, parseNumber(event.target.value, clipDurationMs(clip)))
                                  }
                                ])
                              }
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={timelineApplying}
                              onClick={() => void applyTimelinePatch([{ op: "remove_clip", trackId: track.id, clipId: clip.id }])}
                            >
                              Remove
                            </Button>
                          </div>

                          <div className="grid grid-cols-3 gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={timelineApplying}
                              onClick={() => {
                                const splitAt = clip.timelineInMs + Math.floor((clip.timelineOutMs - clip.timelineInMs) / 2);
                                void applyTimelinePatch([{ op: "split_clip", trackId: track.id, clipId: clip.id, splitMs: splitAt }]);
                              }}
                            >
                              Split
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={timelineApplying}
                              onClick={() =>
                                void applyTimelinePatch([{ op: "trim_clip", trackId: track.id, clipId: clip.id, trimStartMs: 120 }])
                              }
                            >
                              Trim Start
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={timelineApplying}
                              onClick={() =>
                                void applyTimelinePatch([{ op: "trim_clip", trackId: track.id, clipId: clip.id, trimEndMs: 120 }])
                              }
                            >
                              Trim End
                            </Button>
                          </div>

                          <div className="grid grid-cols-3 gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={timelineApplying}
                              onClick={() =>
                                void applyTimelinePatch([
                                  {
                                    op: "move_clip",
                                    trackId: track.id,
                                    clipId: clip.id,
                                    timelineInMs: Math.max(0, clip.timelineInMs - 200)
                                  }
                                ])
                              }
                            >
                              Move -200ms
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={timelineApplying}
                              onClick={() =>
                                void applyTimelinePatch([
                                  { op: "move_clip", trackId: track.id, clipId: clip.id, timelineInMs: clip.timelineInMs + 200 }
                                ])
                              }
                            >
                              Move +200ms
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={timelineApplying}
                              onClick={() => void applyTimelinePatch([{ op: "merge_clip_with_next", trackId: track.id, clipId: clip.id }])}
                            >
                              Merge Next
                            </Button>
                          </div>

                          {track.kind !== "AUDIO" ? (
                            <>
                              <div className="grid gap-2 rounded-md border p-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  Transform
                                </p>
                                <div className="grid grid-cols-3 gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void upsertClipEffect(track.id, clip, "transform", {
                                        x: Number((readTransformNumber(clip, "x", 0.72) - 0.03).toFixed(2))
                                      })
                                    }
                                  >
                                    Left
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void upsertClipEffect(track.id, clip, "transform", {
                                        y: Number((readTransformNumber(clip, "y", 0.72) - 0.03).toFixed(2))
                                      })
                                    }
                                  >
                                    Up
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void upsertClipEffect(track.id, clip, "transform", {
                                        scale: Number((readTransformNumber(clip, "scale", 1) + 0.05).toFixed(2))
                                      })
                                    }
                                  >
                                    Scale +
                                  </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void upsertClipEffect(track.id, clip, "transform", {
                                        x: Number((readTransformNumber(clip, "x", 0.72) + 0.03).toFixed(2))
                                      })
                                    }
                                  >
                                    Right
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void upsertClipEffect(track.id, clip, "transform", {
                                        y: Number((readTransformNumber(clip, "y", 0.72) + 0.03).toFixed(2))
                                      })
                                    }
                                  >
                                    Down
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void upsertClipEffect(track.id, clip, "transform", {
                                        scale: Number(Math.max(0.2, readTransformNumber(clip, "scale", 1) - 0.05).toFixed(2))
                                      })
                                    }
                                  >
                                    Scale -
                                  </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void upsertClipEffect(track.id, clip, "transform", {
                                        opacity: Number(Math.max(0.1, readTransformNumber(clip, "opacity", 1) - 0.1).toFixed(2))
                                      })
                                    }
                                  >
                                    Opacity -
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void upsertClipEffect(track.id, clip, "transform", {
                                        opacity: Number(Math.min(1, readTransformNumber(clip, "opacity", 1) + 0.1).toFixed(2))
                                      })
                                    }
                                  >
                                    Opacity +
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void upsertClipEffect(track.id, clip, "transform", {
                                        rotationDeg: Number((readTransformNumber(clip, "rotationDeg", 0) + 5).toFixed(1))
                                      })
                                    }
                                  >
                                    Rotate +5
                                  </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void addTransformKeyframe(
                                        track.id,
                                        clip,
                                        "scale",
                                        Number(readTransformNumber(clip, "scale", 1).toFixed(2))
                                      )
                                    }
                                  >
                                    KF Scale
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void addTransformKeyframe(
                                        track.id,
                                        clip,
                                        "x",
                                        Number(readTransformNumber(clip, "x", 0.72).toFixed(2))
                                      )
                                    }
                                  >
                                    KF X
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={timelineApplying}
                                    onClick={() =>
                                      void addTransformKeyframe(
                                        track.id,
                                        clip,
                                        "y",
                                        Number(readTransformNumber(clip, "y", 0.72).toFixed(2))
                                      )
                                    }
                                  >
                                    KF Y
                                  </Button>
                                </div>
                              </div>

                              <div className="grid grid-cols-3 gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={timelineApplying}
                                  onClick={() =>
                                    void applyTimelinePatch([
                                      {
                                        op: "set_transition",
                                        trackId: track.id,
                                        clipId: clip.id,
                                        transitionType: "cut",
                                        durationMs: 80
                                      }
                                    ])
                                  }
                                >
                                  Cut
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={timelineApplying}
                                  onClick={() =>
                                    void applyTimelinePatch([
                                      {
                                        op: "set_transition",
                                        trackId: track.id,
                                        clipId: clip.id,
                                        transitionType: "crossfade",
                                        durationMs: 180
                                      }
                                    ])
                                  }
                                >
                                  Crossfade
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={timelineApplying}
                                  onClick={() =>
                                    void applyTimelinePatch([
                                      {
                                        op: "set_transition",
                                        trackId: track.id,
                                        clipId: clip.id,
                                        transitionType: "slide",
                                        durationMs: 220
                                      }
                                    ])
                                  }
                                >
                                  Slide
                                </Button>
                              </div>
                            </>
                          ) : null}

                          {track.kind === "CAPTION" ? (
                            <div className="grid grid-cols-2 gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={timelineApplying}
                                onClick={() =>
                                  void upsertClipEffect(track.id, clip, "caption_style", {
                                    fontSize: 44,
                                    bgOpacity: 0.72
                                  })
                                }
                              >
                                Style: Bold
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={timelineApplying}
                                onClick={() =>
                                  void upsertClipEffect(track.id, clip, "caption_style", {
                                    fontSize: 36,
                                    bgOpacity: 0.52
                                  })
                                }
                              >
                                Style: Soft
                              </Button>
                            </div>
                          ) : null}

                          <p className="text-[11px] text-muted-foreground">
                            Effects: {clip.effects.length} • Source: {clip.slotKey ?? clip.assetId ?? "inline"}
                          </p>
                        </div>
                      ))}
                      {track.clips.length === 0 ? <p className="text-xs text-muted-foreground">No clips yet.</p> : null}
                    </div>
                  </div>
                ))}

                {orderedTracks.length === 0 && !timelineLoading ? (
                  <p className="text-xs text-muted-foreground">No tracks yet. Create your first timeline track above.</p>
                ) : null}
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Revision history</p>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {(timelineState?.revisions ?? []).slice(0, 20).map((revision) => (
                    <div key={revision.id} className="rounded border px-2 py-1 text-xs">
                      <p>
                        Rev {revision.revision} • {new Date(revision.createdAt).toLocaleString()}
                      </p>
                      <p className="truncate text-muted-foreground">
                        {revision.timelineHash.slice(0, 14)}... • {revision.operations.length} ops
                      </p>
                    </div>
                  ))}
                  {(timelineState?.revisions ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No revision history yet.</p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline Tracks</CardTitle>
              <CardDescription>
                Video tracks: {videoTracks.length} • Audio tracks: {audioTracks.length} • Caption tracks: {captionTracks.length}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {orderedTracks.map((track) => (
                <div key={`summary-${track.id}`} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                  <span>
                    {track.name} ({track.kind})
                  </span>
                  <span className="text-muted-foreground">{track.clips.length} clips</span>
                </div>
              ))}
              {orderedTracks.length === 0 ? <p className="text-xs text-muted-foreground">No track summary yet.</p> : null}
            </CardContent>
          </Card>

          <PhaseTwoPanel projectId={projectId} onTimelineRefresh={fetchTimeline} />

          <Card>
            <CardHeader>
              <CardTitle>Render</CardTitle>
              <CardDescription>Queue cloud render and track progress</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Project status</span>
                <Badge>{projectStatus}</Badge>
              </div>
              {missingRequiredSlots.length > 0 ? (
                <p className="text-xs text-muted-foreground">Missing required slots: {missingRequiredSlots.join(", ")}</p>
              ) : (
                <p className="text-xs text-muted-foreground">All required slots are uploaded.</p>
              )}
              <Button
                className="w-full"
                onClick={startRender}
                disabled={startingRender || missingRequiredSlots.length > 0 || projectStatus === "RENDERING"}
              >
                {startingRender ? "Queueing..." : "Render MP4"}
              </Button>

              {currentRenderJob ? (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">Render job: {currentRenderJob.status}</p>
                  <Progress value={currentRenderJob.progress} />
                  <p className="text-xs text-muted-foreground">Progress: {currentRenderJob.progress}%</p>
                  {currentRenderJob.errorMessage ? (
                    <p className="text-xs text-destructive">{currentRenderJob.errorMessage}</p>
                  ) : null}
                  {currentRenderJob.outputUrl ? (
                    <a
                      href={currentRenderJob.outputUrl}
                      className="inline-block rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download MP4
                    </a>
                  ) : null}
                </div>
              ) : null}
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
