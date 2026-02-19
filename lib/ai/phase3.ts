import { join } from "path";
import { randomUUID } from "crypto";
import type { AIJob, AIJobType, ConsentStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { sanitizeOverlayText } from "../sanitize";
import { appendTimelineRevision } from "../project-v2";
import { parseTemplateSlotSchema, projectReadinessFromAssets } from "../template-runtime";
import { buildProjectStorageKey, uploadFileToStorage } from "../storage";
import { probeStorageAsset } from "../ffprobe";

const VIDEO_MIME = "video/mp4";
const IMAGE_MIME = "image/svg+xml";

export type DemoActorPreset = {
  id: string;
  name: string;
  description: string;
  foregroundFile: string;
  backgroundFile: string;
};

export const demoActorPresets: DemoActorPreset[] = [
  {
    id: "demo-host-studio",
    name: "Studio Host",
    description: "Clean explainer tone with center framing.",
    foregroundFile: "demo-portrait.mp4",
    backgroundFile: "pattern-grid.svg"
  },
  {
    id: "demo-host-hype",
    name: "Hype Host",
    description: "Punchier delivery with high-contrast backdrop.",
    foregroundFile: "demo-portrait.mp4",
    backgroundFile: "pattern-waves.svg"
  },
  {
    id: "demo-host-calm",
    name: "Calm Narrator",
    description: "Low-noise look for educational explainers.",
    foregroundFile: "demo-portrait.mp4",
    backgroundFile: "pattern-steps.svg"
  }
];

function selectActorPreset(actorId: string | undefined | null) {
  if (actorId) {
    const direct = demoActorPresets.find((preset) => preset.id === actorId);
    if (direct) {
      return direct;
    }
    const hash = [...actorId].reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return demoActorPresets[hash % demoActorPresets.length];
  }
  return demoActorPresets[0];
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function deriveScript(input: Record<string, unknown>) {
  const script = sanitizeOverlayText(asString(input.script), "");
  if (script) {
    return script;
  }
  const prompt = sanitizeOverlayText(asString(input.prompt), "");
  if (prompt) {
    return prompt;
  }
  return "HookForge AI Creator generated this draft. Tweak lines and render when ready.";
}

type LinkedContext = {
  projectV2: {
    id: string;
    workspaceId: string;
    legacyProjectId: string | null;
    createdByUserId: string | null;
  };
  legacyProject: {
    id: string;
    userId: string;
    title: string;
    config: unknown;
    template: {
      slotSchema: unknown;
      slug: string;
      name: string;
    };
    assets: Array<{ id: string; slotKey: string }>;
  };
};

async function loadLinkedContext(projectV2Id: string): Promise<LinkedContext | null> {
  const projectV2 = await prisma.projectV2.findUnique({
    where: { id: projectV2Id },
    select: {
      id: true,
      workspaceId: true,
      legacyProjectId: true,
      createdByUserId: true
    }
  });

  if (!projectV2?.legacyProjectId) {
    return null;
  }

  const legacyProject = await prisma.project.findUnique({
    where: { id: projectV2.legacyProjectId },
    select: {
      id: true,
      userId: true,
      title: true,
      config: true,
      template: {
        select: {
          slotSchema: true,
          slug: true,
          name: true
        }
      },
      assets: {
        select: {
          id: true,
          slotKey: true
        }
      }
    }
  });

  if (!legacyProject) {
    return null;
  }

  return {
    projectV2,
    legacyProject
  };
}

async function probeWithRetry(storageKey: string, attempts = 4) {
  let lastError: unknown = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await probeStorageAsset(storageKey);
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 220 * (index + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not probe generated media");
}

async function createGeneratedStorageAssets(params: {
  legacyProjectId: string;
  actorPreset: DemoActorPreset;
}) {
  const foregroundLocalPath = join(process.cwd(), "public", "demo-assets", params.actorPreset.foregroundFile);
  const backgroundLocalPath = join(process.cwd(), "public", "demo-assets", params.actorPreset.backgroundFile);

  const foregroundStorageKey = buildProjectStorageKey(params.legacyProjectId, `ai-creator-${params.actorPreset.id}.mp4`);
  const backgroundStorageKey = buildProjectStorageKey(params.legacyProjectId, `ai-creator-${params.actorPreset.id}.svg`);

  await uploadFileToStorage(foregroundStorageKey, foregroundLocalPath, VIDEO_MIME);
  await uploadFileToStorage(backgroundStorageKey, backgroundLocalPath, IMAGE_MIME);

  const probe = await probeWithRetry(foregroundStorageKey);

  return {
    foregroundStorageKey,
    backgroundStorageKey,
    foregroundProbe: probe
  };
}

async function applyAiCreatorJob(aiJob: AIJob) {
  if (!aiJob.projectId) {
    return {
      mode: "generate_video",
      created: false,
      reason: "No project attached to AI creator job"
    };
  }

  const context = await loadLinkedContext(aiJob.projectId);
  if (!context) {
    return {
      mode: "generate_video",
      created: false,
      reason: "Linked legacy project not found"
    };
  }

  const input = asRecord(aiJob.input);
  const mode = asString(input.mode, "generate_video");
  if (mode !== "generate_video") {
    return {
      mode,
      created: false,
      reason: "Phase 3 side-effects only materialize generate_video jobs"
    };
  }

  const actorPreset = selectActorPreset(asString(input.actorId) || asString(input.actorProfileId));
  const generated = await createGeneratedStorageAssets({
    legacyProjectId: context.legacyProject.id,
    actorPreset
  });

  const slotSchema = parseTemplateSlotSchema(context.legacyProject.template.slotSchema);
  const assetsToUpsert: Array<{
    slotKey: string;
    kind: "VIDEO" | "IMAGE";
    storageKey: string;
    mimeType: string;
    durationSec: number | null;
    width: number | null;
    height: number | null;
  }> = [];

  for (const slot of slotSchema.slots) {
    if (slot.kinds.includes("VIDEO")) {
      assetsToUpsert.push({
        slotKey: slot.key,
        kind: "VIDEO",
        storageKey: generated.foregroundStorageKey,
        mimeType: VIDEO_MIME,
        durationSec: generated.foregroundProbe.durationSec,
        width: generated.foregroundProbe.width,
        height: generated.foregroundProbe.height
      });
      continue;
    }
    if (slot.kinds.includes("IMAGE")) {
      assetsToUpsert.push({
        slotKey: slot.key,
        kind: "IMAGE",
        storageKey: generated.backgroundStorageKey,
        mimeType: IMAGE_MIME,
        durationSec: null,
        width: null,
        height: null
      });
    }
  }

  const upserted = [];
  for (const asset of assetsToUpsert) {
    const persisted = await prisma.asset.upsert({
      where: {
        projectId_slotKey: {
          projectId: context.legacyProject.id,
          slotKey: asset.slotKey
        }
      },
      update: {
        kind: asset.kind,
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        durationSec: asset.durationSec,
        width: asset.width,
        height: asset.height
      },
      create: {
        projectId: context.legacyProject.id,
        slotKey: asset.slotKey,
        kind: asset.kind,
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        durationSec: asset.durationSec,
        width: asset.width,
        height: asset.height
      }
    });
    upserted.push(persisted);
  }

  const script = deriveScript(input);
  const durationSec = Math.max(6, Math.min(180, asNumber(input.durationSec, 30)));
  const currentConfig = asRecord(context.legacyProject.config);
  const nextConfig = {
    ...currentConfig,
    captionText: script.slice(0, 180),
    subjectIsolation: asBoolean(currentConfig.subjectIsolation, true),
    subjectIsolationMode: "blur",
    aiCreatorMode: "generate_video",
    aiCreatorActorId: actorPreset.id,
    aiCreatorVoiceId: sanitizeOverlayText(asString(input.voiceId), ""),
    aiCreatorTwinId: sanitizeOverlayText(asString(input.twinId), ""),
    aiCreatorDurationSec: durationSec,
    aiCreatorLastJobId: aiJob.id
  };

  const readiness = projectReadinessFromAssets(context.legacyProject.template, upserted.map((asset) => ({ slotKey: asset.slotKey })));
  const status = readiness.ready ? "READY" : "DRAFT";

  await prisma.project.update({
    where: { id: context.legacyProject.id },
    data: {
      config: nextConfig,
      status
    }
  });

  await prisma.projectV2.update({
    where: { id: context.projectV2.id },
    data: { status }
  });

  await appendTimelineRevision({
    projectId: context.projectV2.id,
    createdByUserId: context.projectV2.createdByUserId ?? context.legacyProject.userId,
    operations: [
      {
        op: "phase3_ai_creator_generate",
        aiJobId: aiJob.id,
        actorPresetId: actorPreset.id,
        slots: upserted.map((asset) => ({
          slotKey: asset.slotKey,
          storageKey: asset.storageKey
        }))
      }
    ]
  });

  const generatedMedia = await prisma.mediaAsset.createMany({
    data: [
      {
        workspaceId: context.projectV2.workspaceId,
        projectId: context.projectV2.id,
        source: "GENERATED",
        storageKey: generated.foregroundStorageKey,
        mimeType: VIDEO_MIME,
        durationSec: generated.foregroundProbe.durationSec,
        width: generated.foregroundProbe.width,
        height: generated.foregroundProbe.height
      },
      {
        workspaceId: context.projectV2.workspaceId,
        projectId: context.projectV2.id,
        source: "GENERATED",
        storageKey: generated.backgroundStorageKey,
        mimeType: IMAGE_MIME
      }
    ]
  });

  await prisma.trustEvent.create({
    data: {
      workspaceId: context.projectV2.workspaceId,
      userId: context.legacyProject.userId,
      eventType: "CONSENT_SUBMITTED",
      severity: "INFO",
      summary: `AI Creator generated a draft for ${context.legacyProject.title}`,
      metadata: {
        aiJobId: aiJob.id,
        legacyProjectId: context.legacyProject.id,
        projectV2Id: context.projectV2.id,
        actorPresetId: actorPreset.id,
        mediaAssetInsertCount: generatedMedia.count
      }
    }
  });

  return {
    mode: "generate_video",
    created: true,
    legacyProjectId: context.legacyProject.id,
    projectV2Id: context.projectV2.id,
    actorPreset,
    slotsFilled: upserted.map((asset) => asset.slotKey),
    ready: readiness.ready,
    missingSlotKeys: readiness.missingSlotKeys
  };
}

export async function applyPhase3SideEffects(aiJob: AIJob) {
  switch (aiJob.type as AIJobType) {
    case "AI_CREATOR":
      return applyAiCreatorJob(aiJob);
    default:
      return null;
  }
}

export function nextConsentStatus(verified: boolean): ConsentStatus {
  return verified ? "VERIFIED" : "PENDING";
}

export function estimatePhase3Credits(params: {
  durationSec: number;
  withTwin: boolean;
  withVoice: boolean;
  hasAudioInput: boolean;
}) {
  const durationBase = Math.max(3, Math.min(180, Math.trunc(params.durationSec)));
  const actorCost = Math.ceil(durationBase * 1.5);
  const twinCost = params.withTwin ? 90 : 0;
  const voiceCost = params.withVoice ? 55 : 0;
  const audioDiscount = params.hasAudioInput ? -20 : 0;
  return Math.max(40, actorCost + twinCost + voiceCost + audioDiscount);
}

export function buildEchoSampleStorageKey(workspaceId: string, extension: string) {
  return `voice-samples/${workspaceId}/${randomUUID()}.${extension.replace(/^\./, "") || "webm"}`;
}
