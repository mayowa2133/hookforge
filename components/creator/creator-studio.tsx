"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ActorPreset = {
  id: string;
  name: string;
  description: string;
  previewVideo: string;
  previewBackground: string;
};

type VoiceClone = {
  id: string;
  status: "PENDING" | "VERIFIED" | "REJECTED" | "REVOKED";
  createdAt: string;
};

type VoiceProfile = {
  id: string;
  name: string;
  provider: string;
  language: string | null;
  voiceClones: VoiceClone[];
};

type TwinProfile = {
  id: string;
  name: string;
  status: "PENDING" | "VERIFIED" | "REJECTED" | "REVOKED";
  avatarProfile: {
    id: string;
    providerAvatarId: string | null;
  } | null;
};

type CreatorProject = {
  id: string;
  title: string;
  status: "DRAFT" | "READY" | "RENDERING" | "DONE" | "ERROR";
  template: {
    id: string;
    slug: string;
    name: string;
    slotSchema: unknown;
  };
};

type AiJob = {
  id: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "ERROR" | "CANCELED";
  progress: number;
  errorMessage?: string | null;
  projectId: string | null;
};

type SlotDefinition = {
  key: string;
  kinds?: string[];
};

function asSlots(slotSchema: unknown): SlotDefinition[] {
  if (!slotSchema || typeof slotSchema !== "object") {
    return [];
  }
  const slots = (slotSchema as { slots?: unknown }).slots;
  if (!Array.isArray(slots)) {
    return [];
  }
  return slots.filter((entry): entry is SlotDefinition => Boolean(entry) && typeof entry === "object" && "key" in entry);
}

function videoSlotKeys(project: CreatorProject) {
  return asSlots(project.template.slotSchema)
    .filter((slot) => Array.isArray(slot.kinds) && slot.kinds.includes("VIDEO"))
    .map((slot) => slot.key);
}

function formatCloneStatus(profile: VoiceProfile) {
  if (profile.voiceClones.length === 0) {
    return "builtin";
  }
  if (profile.voiceClones.some((clone) => clone.status === "VERIFIED")) {
    return "verified";
  }
  return "pending";
}

export function CreatorStudio() {
  const [actors, setActors] = useState<ActorPreset[]>([]);
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [twins, setTwins] = useState<TwinProfile[]>([]);
  const [projects, setProjects] = useState<CreatorProject[]>([]);
  const [jobs, setJobs] = useState<Record<string, AiJob>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [generateScript, setGenerateScript] = useState("Share one practical strategy creators can use this week.");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generateDurationSec, setGenerateDurationSec] = useState("30");
  const [generateTemplateSlug, setGenerateTemplateSlug] = useState("green-screen-commentator");
  const [generateActorId, setGenerateActorId] = useState("");
  const [generateVoiceId, setGenerateVoiceId] = useState("");
  const [generateTwinId, setGenerateTwinId] = useState("");
  const [lastGeneratedProjectId, setLastGeneratedProjectId] = useState<string | null>(null);
  const [lastGeneratedProjectPath, setLastGeneratedProjectPath] = useState<string | null>(null);

  const [voiceName, setVoiceName] = useState("My Voice Clone");
  const [voiceLanguage, setVoiceLanguage] = useState("en");
  const [consentName, setConsentName] = useState("");
  const [consentEmail, setConsentEmail] = useState("");
  const [consentVerified, setConsentVerified] = useState(false);
  const [voiceScriptSample, setVoiceScriptSample] = useState("HookForge helps me publish consistent shorts with less editing time.");
  const [voiceSampleBlob, setVoiceSampleBlob] = useState<Blob | null>(null);
  const [recordingAudio, setRecordingAudio] = useState(false);

  const [twinName, setTwinName] = useState("My Twin");
  const [twinActorId, setTwinActorId] = useState("");
  const [twinVoiceProfileId, setTwinVoiceProfileId] = useState("");
  const [twinConsentName, setTwinConsentName] = useState("");
  const [twinConsentEmail, setTwinConsentEmail] = useState("");
  const [twinConsentVerified, setTwinConsentVerified] = useState(false);

  const [teleprompterTopic, setTeleprompterTopic] = useState("How to write stronger video hooks");
  const [teleprompterTone, setTeleprompterTone] = useState<"direct" | "hype" | "educational" | "story">("direct");
  const [teleprompterDuration, setTeleprompterDuration] = useState("45");
  const [teleprompterScript, setTeleprompterScript] = useState("Start with one clear claim. Then prove it in three quick beats. End with one focused call to action.");
  const [teleprompterRunning, setTeleprompterRunning] = useState(false);
  const [teleprompterSpeed, setTeleprompterSpeed] = useState("1.4");

  const [cameraReady, setCameraReady] = useState(false);
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [uploadProjectId, setUploadProjectId] = useState("");
  const [uploadSlotKey, setUploadSlotKey] = useState("");

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const cameraRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const teleprompterRef = useRef<HTMLDivElement | null>(null);

  const pendingJobIds = useMemo(
    () => Object.values(jobs).filter((job) => job.status === "QUEUED" || job.status === "RUNNING").map((job) => job.id),
    [jobs]
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === uploadProjectId) ?? null,
    [projects, uploadProjectId]
  );

  const availableVideoSlots = useMemo(() => {
    if (!selectedProject) {
      return [];
    }
    return videoSlotKeys(selectedProject);
  }, [selectedProject]);

  const refreshData = async () => {
    const [actorsResponse, profilesResponse, projectsResponse, twinsResponse] = await Promise.all([
      fetch("/api/ai-creator/actors"),
      fetch("/api/ai-creator/profiles"),
      fetch("/api/projects"),
      fetch("/api/ai-creator/twins")
    ]);

    const actorsPayload = await actorsResponse.json();
    const profilesPayload = await profilesResponse.json();
    const projectsPayload = await projectsResponse.json();
    const twinsPayload = await twinsResponse.json();

    if (!actorsResponse.ok) {
      throw new Error(actorsPayload.error ?? "Failed to load actor presets");
    }
    if (!profilesResponse.ok) {
      throw new Error(profilesPayload.error ?? "Failed to load creator profiles");
    }
    if (!projectsResponse.ok) {
      throw new Error(projectsPayload.error ?? "Failed to load projects");
    }
    if (!twinsResponse.ok) {
      throw new Error(twinsPayload.error ?? "Failed to load AI twins");
    }

    const nextActors = (actorsPayload.actors ?? []) as ActorPreset[];
    const nextVoiceProfiles = (profilesPayload.voiceProfiles ?? []) as VoiceProfile[];
    const nextProjects = (projectsPayload.projects ?? []) as CreatorProject[];
    const nextTwins = (twinsPayload.twins ?? []) as TwinProfile[];

    setActors(nextActors);
    setVoiceProfiles(nextVoiceProfiles);
    setProjects(nextProjects);
    setTwins(nextTwins);

    if (!generateActorId && nextActors[0]) {
      setGenerateActorId(nextActors[0].id);
    }
    if (!twinActorId && nextActors[0]) {
      setTwinActorId(nextActors[0].id);
    }
    if (!uploadProjectId && nextProjects[0]) {
      setUploadProjectId(nextProjects[0].id);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        await refreshData();
        if (!cancelled) {
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load creator studio");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
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
            throw new Error(payload.error ?? "Failed to fetch AI job status");
          }

          const nextJob = payload.aiJob as AiJob;
          setJobs((current) => ({
            ...current,
            [nextJob.id]: nextJob
          }));

          if (nextJob.status === "DONE" || nextJob.status === "ERROR") {
            await refreshData();
          }
        } catch (pollError) {
          setError(pollError instanceof Error ? pollError.message : "AI job polling failed");
        }
      }
    }, 2200);

    return () => clearInterval(poll);
  }, [pendingJobIds]);

  useEffect(() => {
    if (!selectedProject) {
      return;
    }
    const slots = videoSlotKeys(selectedProject);
    if (slots.length === 0) {
      setUploadSlotKey("");
      return;
    }
    if (!uploadSlotKey || !slots.includes(uploadSlotKey)) {
      setUploadSlotKey(slots[0]);
    }
  }, [selectedProject, uploadSlotKey]);

  useEffect(() => {
    if (!teleprompterRunning || !teleprompterRef.current) {
      return;
    }

    const node = teleprompterRef.current;
    const speed = Number(teleprompterSpeed);
    const pxPerTick = Number.isFinite(speed) ? Math.max(0.4, Math.min(8, speed)) : 1.4;

    const interval = setInterval(() => {
      if (!node) {
        return;
      }
      node.scrollTop += pxPerTick;
      const reachedEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 6;
      if (reachedEnd) {
        setTeleprompterRunning(false);
      }
    }, 30);

    return () => clearInterval(interval);
  }, [teleprompterRunning, teleprompterSpeed]);

  useEffect(() => {
    return () => {
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!videoBlob) {
      setVideoPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(videoBlob);
    setVideoPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [videoBlob]);

  const registerTrackedJob = (job: AiJob) => {
    setJobs((current) => ({
      ...current,
      [job.id]: job
    }));
  };

  const runCreatorGenerate = async () => {
    setBusyAction("generate");
    setError(null);
    setSuccess(null);

    try {
      const durationSec = Number(generateDurationSec);
      const payload = {
        script: generateScript.trim() || undefined,
        prompt: generatePrompt.trim() || undefined,
        actorId: generateActorId || undefined,
        voiceId: generateVoiceId || undefined,
        twinId: generateTwinId || undefined,
        style: "creator-default",
        durationSec: Number.isFinite(durationSec) ? durationSec : 30,
        templateSlug: generateTemplateSlug
      };

      const response = await fetch("/api/ai-creator/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "AI Creator generation failed");
      }

      setLastGeneratedProjectId((data.legacyProjectId as string) ?? null);
      setLastGeneratedProjectPath((data.projectEditorPath as string) ?? null);
      if (typeof data.aiJobId === "string") {
        registerTrackedJob({
          id: data.aiJobId,
          type: "AI_CREATOR",
          status: "QUEUED",
          progress: 0,
          projectId: (data.legacyProjectId as string) ?? null
        });
      }

      const rating = typeof data?.qualitySummary?.ratingScore === "number" ? data.qualitySummary.ratingScore : null;
      const uplift = typeof data?.qualitySummary?.candidateUpliftPct === "number" ? data.qualitySummary.candidateUpliftPct : null;
      if (rating !== null && uplift !== null) {
        setSuccess(`AI Creator job queued. Estimated credits: ${data.creditEstimate}. Ranked quality ${rating}/5, uplift ${uplift}%.`);
      } else {
        setSuccess(`AI Creator job queued. Estimated credits: ${data.creditEstimate}.`);
      }
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "AI Creator generation failed");
    } finally {
      setBusyAction(null);
    }
  };

  const startAudioRecording = async () => {
    setError(null);
    setSuccess(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        setVoiceSampleBlob(blob);
        audioStreamRef.current?.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
      };

      audioRecorderRef.current = recorder;
      recorder.start(300);
      setRecordingAudio(true);
    } catch (recordError) {
      setError(recordError instanceof Error ? recordError.message : "Could not start audio recording");
    }
  };

  const stopAudioRecording = () => {
    const recorder = audioRecorderRef.current;
    if (!recorder) {
      return;
    }
    recorder.stop();
    setRecordingAudio(false);
  };

  const submitEchoVoice = async () => {
    if (!voiceSampleBlob) {
      setError("Record a voice sample before submitting AI Echo.");
      return;
    }

    setBusyAction("echo");
    setError(null);
    setSuccess(null);

    try {
      const presignResponse = await fetch("/api/ai-creator/echo/presign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fileName: "echo-sample.webm",
          mimeType: voiceSampleBlob.type || "audio/webm"
        })
      });
      const presignPayload = await presignResponse.json();
      if (!presignResponse.ok) {
        throw new Error(presignPayload.error ?? "Could not get echo upload URL");
      }

      const uploadResponse = await fetch(presignPayload.uploadUrl as string, {
        method: "PUT",
        headers: {
          "Content-Type": voiceSampleBlob.type || "audio/webm"
        },
        body: voiceSampleBlob
      });
      if (!uploadResponse.ok) {
        throw new Error("Could not upload echo sample audio");
      }

      const submitResponse = await fetch("/api/ai-creator/echo/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: voiceName,
          language: voiceLanguage,
          sampleStorageKey: presignPayload.storageKey,
          scriptSample: voiceScriptSample,
          consent: {
            subjectName: consentName,
            subjectEmail: consentEmail || undefined,
            verified: consentVerified
          }
        })
      });
      const submitPayload = await submitResponse.json();
      if (!submitResponse.ok) {
        throw new Error(submitPayload.error ?? "AI Echo submit failed");
      }

      if (typeof submitPayload.aiJobId === "string") {
        registerTrackedJob({
          id: submitPayload.aiJobId,
          type: "AI_CREATOR",
          status: "QUEUED",
          progress: 0,
          projectId: null
        });
      }

      await refreshData();
      setSuccess(`AI Echo voice onboarding submitted. Credits reserved: ${submitPayload.creditEstimate}.`);
      setVoiceSampleBlob(null);
    } catch (echoError) {
      setError(echoError instanceof Error ? echoError.message : "AI Echo submit failed");
    } finally {
      setBusyAction(null);
    }
  };

  const createTwin = async () => {
    setBusyAction("twin");
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/ai-creator/twins", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: twinName,
          actorId: twinActorId || undefined,
          voiceProfileId: twinVoiceProfileId || undefined,
          consent: {
            subjectName: twinConsentName,
            subjectEmail: twinConsentEmail || undefined,
            verified: twinConsentVerified
          }
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "AI twin creation failed");
      }

      await refreshData();
      setSuccess(`AI Twin created: ${payload.twin?.name ?? "Twin"}.`);
    } catch (twinError) {
      setError(twinError instanceof Error ? twinError.message : "AI twin creation failed");
    } finally {
      setBusyAction(null);
    }
  };

  const generateTeleprompterScript = async () => {
    setBusyAction("assist");
    setError(null);
    try {
      const response = await fetch("/api/ai-creator/teleprompter/assist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          topic: teleprompterTopic,
          tone: teleprompterTone,
          durationSec: Number(teleprompterDuration)
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not generate teleprompter script");
      }
      setTeleprompterScript(payload.script as string);
    } catch (assistError) {
      setError(assistError instanceof Error ? assistError.message : "Could not generate teleprompter script");
    } finally {
      setBusyAction(null);
    }
  };

  const startCamera = async () => {
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          width: { ideal: 720 },
          height: { ideal: 1280 },
          facingMode: "user"
        }
      });
      cameraStreamRef.current = stream;

      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
      }
      setCameraReady(true);
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : "Could not start camera");
    }
  };

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setRecordingVideo(false);
  };

  const startVideoRecording = () => {
    const stream = cameraStreamRef.current;
    if (!stream) {
      setError("Start camera before recording.");
      return;
    }

    const recorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      setVideoBlob(blob);
    };

    cameraRecorderRef.current = recorder;
    recorder.start(350);
    setRecordingVideo(true);
  };

  const stopVideoRecording = () => {
    const recorder = cameraRecorderRef.current;
    if (!recorder) {
      return;
    }
    recorder.stop();
    setRecordingVideo(false);
  };

  const uploadRecordedVideoToSlot = async () => {
    if (!videoBlob) {
      setError("Record a video clip before uploading.");
      return;
    }
    if (!uploadProjectId || !uploadSlotKey) {
      setError("Select a target project and slot before upload.");
      return;
    }

    setBusyAction("camera-upload");
    setError(null);
    setSuccess(null);

    try {
      const fileName = `creator-capture-${Date.now()}.webm`;
      const presignResponse = await fetch(`/api/projects/${uploadProjectId}/assets/presign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          slotKey: uploadSlotKey,
          fileName,
          mimeType: videoBlob.type || "video/webm",
          sizeBytes: videoBlob.size
        })
      });
      const presignPayload = await presignResponse.json();
      if (!presignResponse.ok) {
        throw new Error(presignPayload.error ?? "Could not get project upload URL");
      }

      const uploadResponse = await fetch(presignPayload.uploadUrl as string, {
        method: "PUT",
        headers: {
          "Content-Type": videoBlob.type || "video/webm"
        },
        body: videoBlob
      });
      if (!uploadResponse.ok) {
        throw new Error("Project asset upload failed");
      }

      const registerResponse = await fetch(`/api/projects/${uploadProjectId}/assets/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          slotKey: uploadSlotKey,
          storageKey: presignPayload.storageKey,
          mimeType: videoBlob.type || "video/webm"
        })
      });
      const registerPayload = await registerResponse.json();
      if (!registerResponse.ok) {
        throw new Error(registerPayload.error ?? "Could not register uploaded capture");
      }

      await refreshData();
      setSuccess(`Uploaded recording to slot '${uploadSlotKey}'. Project status: ${registerPayload.project?.status ?? "unknown"}.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Capture upload failed");
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading creator studio...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
          Creator Studio (Phase 3)
        </h1>
        <p className="text-sm text-muted-foreground">
          Prompt/script/audio to draft generation, AI Echo voice onboarding, AI twins, teleprompter assist, and camera capture.
        </p>
      </div>

      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="pt-6 text-sm text-amber-900">
          Upload and clone only voices/faces you own or have explicit permission to use. Voice cloning and AI twin usage require consent verification.
        </CardContent>
      </Card>

      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {success ? <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700">{success}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>AI Creator Generate</CardTitle>
            <CardDescription>Create a draft project and auto-fill required media slots.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Script</Label>
              <Textarea value={generateScript} onChange={(event) => setGenerateScript(event.target.value)} rows={4} />
            </div>
            <div className="space-y-1">
              <Label>Prompt (optional)</Label>
              <Textarea value={generatePrompt} onChange={(event) => setGeneratePrompt(event.target.value)} rows={2} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Template</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={generateTemplateSlug}
                  onChange={(event) => setGenerateTemplateSlug(event.target.value)}
                >
                  <option value="green-screen-commentator">Green Screen Commentator</option>
                  <option value="tweet-comment-popup-reply">Tweet/Comment Pop-up Reply</option>
                  <option value="three-beat-montage-intro-main-talk">3-Beat Montage + Main Talk</option>
                  <option value="split-screen-reaction">Split-screen Reaction</option>
                  <option value="fake-facetime-incoming-call">Fake FaceTime Opener</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Duration (sec)</Label>
                <Input value={generateDurationSec} onChange={(event) => setGenerateDurationSec(event.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label>Actor</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={generateActorId}
                  onChange={(event) => setGenerateActorId(event.target.value)}
                >
                  {actors.map((actor) => (
                    <option value={actor.id} key={actor.id}>
                      {actor.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Voice profile (optional)</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={generateVoiceId}
                  onChange={(event) => setGenerateVoiceId(event.target.value)}
                >
                  <option value="">None</option>
                  {voiceProfiles.map((profile) => (
                    <option value={profile.id} key={profile.id}>
                      {profile.name} ({formatCloneStatus(profile)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>AI twin (optional)</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={generateTwinId}
                  onChange={(event) => setGenerateTwinId(event.target.value)}
                >
                  <option value="">None</option>
                  {twins.map((twin) => (
                    <option value={twin.id} key={twin.id}>
                      {twin.name} ({twin.status.toLowerCase()})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button onClick={runCreatorGenerate} disabled={busyAction === "generate"}>
              {busyAction === "generate" ? "Queueing..." : "Generate Draft Project"}
            </Button>
            {lastGeneratedProjectPath ? (
              <p className="text-sm text-muted-foreground">
                Last generated project: <Link className="underline" href={lastGeneratedProjectPath}>open editor</Link>
                {lastGeneratedProjectId ? ` (${lastGeneratedProjectId})` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actor Presets</CardTitle>
            <CardDescription>Deterministic local presets used in MVP generation flows.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {actors.map((actor) => (
              <div className="rounded-md border p-3" key={actor.id}>
                <div className="flex items-center justify-between">
                  <p className="font-medium">{actor.name}</p>
                  <Badge variant="secondary">{actor.id}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{actor.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>AI Echo Voice Onboarding</CardTitle>
            <CardDescription>Record a voice sample, upload securely, and create a consent-tracked clone profile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Voice profile name</Label>
                <Input value={voiceName} onChange={(event) => setVoiceName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Language</Label>
                <Input value={voiceLanguage} onChange={(event) => setVoiceLanguage(event.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Script sample (optional)</Label>
              <Textarea value={voiceScriptSample} onChange={(event) => setVoiceScriptSample(event.target.value)} rows={2} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Consent name</Label>
                <Input value={consentName} onChange={(event) => setConsentName(event.target.value)} placeholder="Legal subject name" />
              </div>
              <div className="space-y-1">
                <Label>Consent email</Label>
                <Input value={consentEmail} onChange={(event) => setConsentEmail(event.target.value)} placeholder="optional@email.com" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={consentVerified}
                onChange={(event) => setConsentVerified(event.target.checked)}
              />
              I confirm this voice is mine (or I have explicit permission).
            </label>

            <div className="flex flex-wrap gap-2">
              {recordingAudio ? (
                <Button variant="outline" onClick={stopAudioRecording}>Stop Recording</Button>
              ) : (
                <Button variant="outline" onClick={startAudioRecording}>Record Voice Sample</Button>
              )}
              <Button onClick={submitEchoVoice} disabled={busyAction === "echo" || !voiceSampleBlob}>
                {busyAction === "echo" ? "Submitting..." : "Submit AI Echo"}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Sample status: {voiceSampleBlob ? `ready (${Math.round(voiceSampleBlob.size / 1024)} KB)` : "not recorded"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Twin Onboarding</CardTitle>
            <CardDescription>Attach an actor profile and optional voice profile with consent-tracked verification.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Twin name</Label>
              <Input value={twinName} onChange={(event) => setTwinName(event.target.value)} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Actor</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={twinActorId}
                  onChange={(event) => setTwinActorId(event.target.value)}
                >
                  {actors.map((actor) => (
                    <option value={actor.id} key={actor.id}>
                      {actor.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Voice profile (optional)</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={twinVoiceProfileId}
                  onChange={(event) => setTwinVoiceProfileId(event.target.value)}
                >
                  <option value="">None</option>
                  {voiceProfiles.map((profile) => (
                    <option value={profile.id} key={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Consent name</Label>
                <Input value={twinConsentName} onChange={(event) => setTwinConsentName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Consent email</Label>
                <Input value={twinConsentEmail} onChange={(event) => setTwinConsentEmail(event.target.value)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={twinConsentVerified}
                onChange={(event) => setTwinConsentVerified(event.target.checked)}
              />
              Consent has been verified for this twin.
            </label>
            <Button onClick={createTwin} disabled={busyAction === "twin"}>
              {busyAction === "twin" ? "Creating..." : "Create AI Twin"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Teleprompter</CardTitle>
            <CardDescription>Generate a script draft, then auto-scroll while you record.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <Label>Topic</Label>
                <Input value={teleprompterTopic} onChange={(event) => setTeleprompterTopic(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Tone</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={teleprompterTone}
                  onChange={(event) => setTeleprompterTone(event.target.value as "direct" | "hype" | "educational" | "story")}
                >
                  <option value="direct">Direct</option>
                  <option value="hype">Hype</option>
                  <option value="educational">Educational</option>
                  <option value="story">Story</option>
                </select>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Duration (sec)</Label>
                <Input value={teleprompterDuration} onChange={(event) => setTeleprompterDuration(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Scroll speed</Label>
                <Input value={teleprompterSpeed} onChange={(event) => setTeleprompterSpeed(event.target.value)} />
              </div>
            </div>

            <Textarea value={teleprompterScript} onChange={(event) => setTeleprompterScript(event.target.value)} rows={6} />

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={generateTeleprompterScript} disabled={busyAction === "assist"}>
                {busyAction === "assist" ? "Generating..." : "AI Script Assist"}
              </Button>
              <Button variant="outline" onClick={() => setTeleprompterRunning((current) => !current)}>
                {teleprompterRunning ? "Pause Scroll" : "Start Scroll"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setTeleprompterRunning(false);
                  if (teleprompterRef.current) {
                    teleprompterRef.current.scrollTop = 0;
                  }
                }}
              >
                Reset Scroll
              </Button>
            </div>

            <div ref={teleprompterRef} className="h-48 overflow-y-auto rounded-md border bg-black p-4 text-lg leading-relaxed text-white">
              {teleprompterScript}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Camera Capture + Upload</CardTitle>
            <CardDescription>Record in-browser and push directly into any project video slot.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {cameraReady ? (
                <Button variant="outline" onClick={stopCamera}>Stop Camera</Button>
              ) : (
                <Button variant="outline" onClick={startCamera}>Start Camera</Button>
              )}
              {cameraReady && !recordingVideo ? (
                <Button variant="outline" onClick={startVideoRecording}>Start Recording</Button>
              ) : null}
              {cameraReady && recordingVideo ? (
                <Button variant="outline" onClick={stopVideoRecording}>Stop Recording</Button>
              ) : null}
            </div>

            <video ref={cameraVideoRef} autoPlay playsInline muted className="h-64 w-full rounded-md border bg-black object-cover" />

            {videoPreviewUrl ? (
              <video src={videoPreviewUrl} controls className="h-44 w-full rounded-md border object-cover" />
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Target project</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={uploadProjectId}
                  onChange={(event) => setUploadProjectId(event.target.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title} ({project.template.slug})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label>Target slot</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={uploadSlotKey}
                  onChange={(event) => setUploadSlotKey(event.target.value)}
                >
                  {availableVideoSlots.map((slotKey) => (
                    <option value={slotKey} key={slotKey}>
                      {slotKey}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button onClick={uploadRecordedVideoToSlot} disabled={busyAction === "camera-upload" || !videoBlob}>
              {busyAction === "camera-upload" ? "Uploading..." : "Upload Recording to Slot"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Jobs</CardTitle>
          <CardDescription>Creator job status polling (queue to completion).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.values(jobs).length === 0 ? (
            <p className="text-sm text-muted-foreground">No creator AI jobs yet.</p>
          ) : (
            Object.values(jobs)
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((job) => (
                <div key={job.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <div>
                    <p className="font-medium">{job.type} - {job.id}</p>
                    <p className="text-xs text-muted-foreground">{job.errorMessage ?? "No error"}</p>
                  </div>
                  <Badge variant={job.status === "ERROR" ? "outline" : "secondary"}>
                    {job.status} ({job.progress}%)
                  </Badge>
                </div>
              ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
