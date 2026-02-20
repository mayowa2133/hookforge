import { join } from "path";
import type { AIJob, AIJobType } from "@prisma/client";
import { prisma } from "../prisma";
import { sanitizeOverlayText } from "../sanitize";
import { appendTimelineRevision, ensureProjectV2FromLegacy } from "../project-v2";
import { getDefaultConfigFromTemplate, parseTemplateSlotSchema, projectReadinessFromAssets } from "../template-runtime";
import { buildProjectStorageKey, uploadFileToStorage } from "../storage";
import { probeStorageAsset } from "../ffprobe";
import { detectSourceTypeFromUrl, type ComplianceSourceType } from "../compliance";

const VIDEO_MIME = "video/mp4";
const PNG_MIME = "image/png";
const SVG_MIME = "image/svg+xml";
const DEFAULT_TEMPLATE_SLUG = "green-screen-commentator";

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
      id: string;
      slug: string;
      name: string;
      slotSchema: unknown;
    };
  };
};

type GeneratedAssetPack = {
  videoStorageKey: string;
  imageStorageKey: string;
  imageMimeType: string;
  videoProbe: {
    durationSec: number | null;
    width: number | null;
    height: number | null;
  };
};

type ShortlistClip = {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
};

const demoBackgrounds = [
  { fileName: "pattern-grid.svg", mimeType: SVG_MIME },
  { fileName: "pattern-waves.svg", mimeType: SVG_MIME },
  { fileName: "pattern-steps.svg", mimeType: SVG_MIME },
  { fileName: "mock-comment.png", mimeType: PNG_MIME }
] as const;

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "website";
  }
}

function domainTitle(domain: string) {
  const normalized = domain.replace(/\.[a-z0-9-]+$/i, "").replace(/[^a-z0-9]+/gi, " ").trim();
  if (!normalized) {
    return "Your Product";
  }
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

export function buildDeterministicAdScript(params: {
  websiteUrl: string;
  productName?: string;
  tone: string;
}) {
  const domain = parseDomain(params.websiteUrl);
  const product = sanitizeOverlayText(params.productName ?? domainTitle(domain), domainTitle(domain));
  const tone = sanitizeOverlayText(params.tone, "ugc").toLowerCase();

  const openingByTone: Record<string, string> = {
    ugc: `I tried ${product} so you don't waste time testing random tools.`,
    direct: `${product} gives you a repeatable way to ship short-form faster.`,
    cinematic: `If your content pipeline feels chaotic, ${product} is the missing system.`,
    energetic: `${product} is the fastest way to turn raw footage into publish-ready clips.`
  };

  const hook = openingByTone[tone] ?? openingByTone.ugc;
  const proof = `${product} keeps your hook, structure, and output in one workflow so every post ships with less editing overhead.`;
  const cta = `Comment "${product.split(" ")[0] || "HOOK"}" and I'll share the exact setup.`;

  return {
    product,
    domain,
    tone,
    hook,
    proof,
    cta,
    lines: [hook, proof, cta]
  };
}

function seedFromString(value: string) {
  return [...value].reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

export function buildDeterministicShortlist(params: {
  sourceUrl?: string;
  sourceType: ComplianceSourceType;
  clipCount: number;
  language: string;
  durationSec?: number;
}) {
  const count = clamp(Math.trunc(params.clipCount), 1, 5);
  const sourceLabel = params.sourceUrl ? parseDomain(params.sourceUrl) : "uploaded source";
  const sourceSeed = seedFromString(`${sourceLabel}:${params.language}:${params.sourceType}`);
  const span = clamp(asNumber(params.durationSec, 120), 30, 1800);
  const windowSec = clamp(Math.floor(span / (count + 1)), 12, 45);

  const clips: ShortlistClip[] = [];
  for (let index = 0; index < count; index += 1) {
    const offsetSeed = (sourceSeed + index * 31) % Math.max(20, Math.floor(span - windowSec));
    const startSec = clamp(offsetSeed, 0, Math.max(1, Math.floor(span - windowSec)));
    const endSec = clamp(startSec + windowSec, startSec + 8, Math.floor(span));
    clips.push({
      id: `clip-${index + 1}`,
      startSec,
      endSec,
      title: `Highlight ${index + 1}: ${sourceLabel}`,
      reason:
        params.sourceType === "REDDIT"
          ? "High engagement phrasing and opinion pivot."
          : "Strong hook-to-proof segment with concise pacing."
    });
  }

  return {
    sourceLabel,
    confidence: Number((0.73 + (count - 1) * 0.03).toFixed(2)),
    clips
  };
}

export function extractRedditContext(params: {
  redditUrl: string;
  postTitle?: string;
  postBody?: string;
}) {
  const parsed = new URL(params.redditUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const subreddit = segments.find((segment, index) => segments[index - 1] === "r") ?? "unknown";
  const slug = segments[segments.length - 1] ?? "post";
  const inferredTitle = slug.replace(/[_-]+/g, " ").trim();

  const title = sanitizeOverlayText(params.postTitle ?? (inferredTitle || "Reddit post"), "Reddit post");
  const body = sanitizeOverlayText(
    params.postBody ?? `Thread summary from r/${subreddit}: ${title}.`,
    `Thread summary from r/${subreddit}: ${title}.`
  );

  return {
    subreddit,
    title,
    body,
    prompt: `Create a short-form response video for r/${subreddit} about \"${title}\" with a clear stance and CTA.`
  };
}

export function estimatePhase4AdsCredits(params: { durationSec: number; hasVoice: boolean }) {
  const durationFactor = clamp(Math.trunc(params.durationSec), 10, 120);
  const base = 120 + durationFactor * 2;
  return base + (params.hasVoice ? 40 : 0);
}

export function estimatePhase4ShortsCredits(params: { clipCount: number; sourceType: ComplianceSourceType }) {
  const countCost = clamp(Math.trunc(params.clipCount), 1, 5) * 70;
  const sourceModifier = params.sourceType === "REDDIT" ? 35 : params.sourceType === "YOUTUBE" ? 45 : 20;
  return countCost + sourceModifier;
}

async function loadLinkedContext(projectV2Id: string): Promise<LinkedContext | null> {
  const projectV2 = await prisma.projectV2.findUnique({
    where: {
      id: projectV2Id
    },
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
    where: {
      id: projectV2.legacyProjectId
    },
    select: {
      id: true,
      userId: true,
      title: true,
      config: true,
      template: {
        select: {
          id: true,
          slug: true,
          name: true,
          slotSchema: true
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

async function createGeneratedAssetPack(params: {
  legacyProjectId: string;
  variantSeed: number;
  prefix: string;
}) {
  const background = demoBackgrounds[Math.abs(params.variantSeed) % demoBackgrounds.length];

  const videoLocalPath = join(process.cwd(), "public", "demo-assets", "demo-portrait.mp4");
  const imageLocalPath = join(process.cwd(), "public", "demo-assets", background.fileName);

  const videoStorageKey = buildProjectStorageKey(params.legacyProjectId, `${params.prefix}-foreground.mp4`);
  const imageStorageKey = buildProjectStorageKey(params.legacyProjectId, `${params.prefix}-${background.fileName}`);

  await uploadFileToStorage(videoStorageKey, videoLocalPath, VIDEO_MIME);
  await uploadFileToStorage(imageStorageKey, imageLocalPath, background.mimeType);

  const probe = await probeStorageAsset(videoStorageKey);

  return {
    videoStorageKey,
    imageStorageKey,
    imageMimeType: background.mimeType,
    videoProbe: {
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height
    }
  } satisfies GeneratedAssetPack;
}

async function upsertTemplateAssets(params: {
  legacyProjectId: string;
  templateSlotSchema: unknown;
  generated: GeneratedAssetPack;
}) {
  const schema = parseTemplateSlotSchema(params.templateSlotSchema);
  const upserted = [] as Array<{ id: string; slotKey: string }>;

  for (const slot of schema.slots) {
    if (slot.kinds.includes("VIDEO")) {
      const asset = await prisma.asset.upsert({
        where: {
          projectId_slotKey: {
            projectId: params.legacyProjectId,
            slotKey: slot.key
          }
        },
        update: {
          kind: "VIDEO",
          storageKey: params.generated.videoStorageKey,
          mimeType: VIDEO_MIME,
          durationSec: params.generated.videoProbe.durationSec,
          width: params.generated.videoProbe.width,
          height: params.generated.videoProbe.height
        },
        create: {
          projectId: params.legacyProjectId,
          slotKey: slot.key,
          kind: "VIDEO",
          storageKey: params.generated.videoStorageKey,
          mimeType: VIDEO_MIME,
          durationSec: params.generated.videoProbe.durationSec,
          width: params.generated.videoProbe.width,
          height: params.generated.videoProbe.height
        },
        select: {
          id: true,
          slotKey: true
        }
      });
      upserted.push(asset);
      continue;
    }

    if (slot.kinds.includes("IMAGE")) {
      const asset = await prisma.asset.upsert({
        where: {
          projectId_slotKey: {
            projectId: params.legacyProjectId,
            slotKey: slot.key
          }
        },
        update: {
          kind: "IMAGE",
          storageKey: params.generated.imageStorageKey,
          mimeType: params.generated.imageMimeType,
          durationSec: null,
          width: null,
          height: null
        },
        create: {
          projectId: params.legacyProjectId,
          slotKey: slot.key,
          kind: "IMAGE",
          storageKey: params.generated.imageStorageKey,
          mimeType: params.generated.imageMimeType,
          durationSec: null,
          width: null,
          height: null
        },
        select: {
          id: true,
          slotKey: true
        }
      });
      upserted.push(asset);
    }
  }

  return upserted;
}

async function applyAiAdsJob(aiJob: AIJob) {
  if (!aiJob.projectId) {
    return {
      created: false,
      reason: "No project attached to AI ads job"
    };
  }

  const context = await loadLinkedContext(aiJob.projectId);
  if (!context) {
    return {
      created: false,
      reason: "Linked legacy project not found"
    };
  }

  const input = asRecord(aiJob.input);
  const websiteUrl = asString(input.websiteUrl);
  const productName = asString(input.productName);
  const tone = asString(input.tone, "ugc");

  const script = buildDeterministicAdScript({
    websiteUrl,
    productName,
    tone
  });

  const generated = await createGeneratedAssetPack({
    legacyProjectId: context.legacyProject.id,
    variantSeed: seedFromString(script.domain),
    prefix: `ai-ads-${script.domain.replace(/[^a-z0-9]+/gi, "-")}`
  });

  const upserted = await upsertTemplateAssets({
    legacyProjectId: context.legacyProject.id,
    templateSlotSchema: context.legacyProject.template.slotSchema,
    generated
  });

  const currentConfig = asRecord(context.legacyProject.config);
  const nextConfig = {
    ...currentConfig,
    captionText: script.hook.slice(0, 180),
    aiAdsDomain: script.domain,
    aiAdsProduct: script.product,
    aiAdsTone: script.tone,
    aiAdsScript: script.lines,
    aiAdsLastJobId: aiJob.id
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
    data: {
      status
    }
  });

  await prisma.mediaAsset.createMany({
    data: [
      {
        workspaceId: context.projectV2.workspaceId,
        projectId: context.projectV2.id,
        source: "GENERATED",
        storageKey: generated.videoStorageKey,
        mimeType: VIDEO_MIME,
        durationSec: generated.videoProbe.durationSec,
        width: generated.videoProbe.width,
        height: generated.videoProbe.height
      },
      {
        workspaceId: context.projectV2.workspaceId,
        projectId: context.projectV2.id,
        source: "GENERATED",
        storageKey: generated.imageStorageKey,
        mimeType: generated.imageMimeType
      }
    ]
  });

  await appendTimelineRevision({
    projectId: context.projectV2.id,
    createdByUserId: context.projectV2.createdByUserId ?? context.legacyProject.userId,
    operations: [
      {
        op: "phase4_ai_ads_generate",
        aiJobId: aiJob.id,
        websiteUrl,
        script
      }
    ]
  });

  await prisma.trustEvent.create({
    data: {
      workspaceId: context.projectV2.workspaceId,
      userId: context.legacyProject.userId,
      eventType: "RIGHTS_ATTESTED",
      severity: "INFO",
      summary: `AI Ads draft generated for ${script.domain}`,
      metadata: {
        aiJobId: aiJob.id,
        legacyProjectId: context.legacyProject.id,
        projectV2Id: context.projectV2.id,
        script
      }
    }
  });

  return {
    created: true,
    legacyProjectId: context.legacyProject.id,
    projectV2Id: context.projectV2.id,
    editableScript: script,
    editableMedia: upserted,
    ready: readiness.ready,
    missingSlotKeys: readiness.missingSlotKeys
  };
}

async function resolveTemplate(slug = DEFAULT_TEMPLATE_SLUG) {
  const template = await prisma.template.findUnique({
    where: {
      slug
    }
  });
  if (!template) {
    throw new Error(`Template not found: ${slug}`);
  }
  return template;
}

async function applyAiShortsJob(aiJob: AIJob) {
  const input = asRecord(aiJob.input);
  const clipCount = clamp(Math.trunc(asNumber(input.clipCount, 3)), 1, 5);
  const sourceUrl = asString(input.sourceUrl, "");
  const sourceType = (asString(input.sourceType) || (sourceUrl ? detectSourceTypeFromUrl(sourceUrl) : "OTHER")) as ComplianceSourceType;
  const language = asString(input.language, "en");
  const sourceDurationSec = asNumber(input.sourceDurationSec, 120);

  const shortlist = buildDeterministicShortlist({
    sourceUrl: sourceUrl || undefined,
    sourceType,
    clipCount,
    language,
    durationSec: sourceDurationSec
  });

  const [workspace, template] = await Promise.all([
    prisma.workspace.findUnique({
      where: {
        id: aiJob.workspaceId
      },
      select: {
        id: true,
        ownerId: true
      }
    }),
    resolveTemplate(DEFAULT_TEMPLATE_SLUG)
  ]);

  if (!workspace) {
    return {
      created: false,
      reason: "Workspace not found"
    };
  }

  const generatedProjects: Array<{
    legacyProjectId: string;
    projectV2Id: string;
    title: string;
    clipId: string;
    startSec: number;
    endSec: number;
  }> = [];

  for (let index = 0; index < shortlist.clips.length; index += 1) {
    const clip = shortlist.clips[index];
    const legacyProject = await prisma.project.create({
      data: {
        userId: workspace.ownerId,
        workspaceId: workspace.id,
        templateId: template.id,
        title: `AI Short ${index + 1}: ${shortlist.sourceLabel}`,
        status: "DRAFT",
        config: {
          ...getDefaultConfigFromTemplate(template),
          captionText: clip.title,
          aiShortClipId: clip.id,
          aiShortStartSec: clip.startSec,
          aiShortEndSec: clip.endSec,
          aiShortSourceType: sourceType,
          aiShortLanguage: language,
          aiShortParentJobId: aiJob.id
        }
      }
    });

    const projectV2 = await ensureProjectV2FromLegacy({
      legacyProjectId: legacyProject.id,
      workspaceId: workspace.id,
      createdByUserId: workspace.ownerId,
      title: legacyProject.title,
      status: legacyProject.status
    });

    const generated = await createGeneratedAssetPack({
      legacyProjectId: legacyProject.id,
      variantSeed: seedFromString(`${clip.id}:${sourceType}:${index}`),
      prefix: `ai-shorts-${clip.id}`
    });

    const upserted = await upsertTemplateAssets({
      legacyProjectId: legacyProject.id,
      templateSlotSchema: template.slotSchema,
      generated
    });

    const readiness = projectReadinessFromAssets(template, upserted.map((asset) => ({ slotKey: asset.slotKey })));
    const status = readiness.ready ? "READY" : "DRAFT";

    await prisma.project.update({
      where: { id: legacyProject.id },
      data: {
        status
      }
    });

    await prisma.projectV2.update({
      where: {
        id: projectV2.id
      },
      data: {
        status
      }
    });

    await prisma.mediaAsset.createMany({
      data: [
        {
          workspaceId: workspace.id,
          projectId: projectV2.id,
          source: "GENERATED",
          storageKey: generated.videoStorageKey,
          mimeType: VIDEO_MIME,
          durationSec: generated.videoProbe.durationSec,
          width: generated.videoProbe.width,
          height: generated.videoProbe.height
        },
        {
          workspaceId: workspace.id,
          projectId: projectV2.id,
          source: "GENERATED",
          storageKey: generated.imageStorageKey,
          mimeType: generated.imageMimeType
        }
      ]
    });

    await appendTimelineRevision({
      projectId: projectV2.id,
      createdByUserId: workspace.ownerId,
      operations: [
        {
          op: "phase4_ai_shorts_generate",
          aiJobId: aiJob.id,
          clip,
          sourceType,
          sourceUrl: sourceUrl || null
        }
      ]
    });

    generatedProjects.push({
      legacyProjectId: legacyProject.id,
      projectV2Id: projectV2.id,
      title: legacyProject.title,
      clipId: clip.id,
      startSec: clip.startSec,
      endSec: clip.endSec
    });
  }

  await prisma.trustEvent.create({
    data: {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      eventType: "RIGHTS_ATTESTED",
      severity: "INFO",
      summary: `AI Shorts generated ${generatedProjects.length} project drafts from ${sourceType.toLowerCase()} source`,
      metadata: {
        aiJobId: aiJob.id,
        sourceType,
        sourceUrl: sourceUrl || null,
        generatedProjects
      }
    }
  });

  return {
    created: true,
    sourceType,
    sourceUrl: sourceUrl || null,
    confidence: shortlist.confidence,
    shortlistClips: shortlist.clips,
    editableProjects: generatedProjects
  };
}

export async function applyPhase4SideEffects(aiJob: AIJob) {
  switch (aiJob.type as AIJobType) {
    case "AI_ADS":
      return applyAiAdsJob(aiJob);
    case "AI_SHORTS":
      return applyAiShortsJob(aiJob);
    default:
      return null;
  }
}
