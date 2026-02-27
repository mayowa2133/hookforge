export type Phase5ShareScope = "VIEW" | "COMMENT" | "APPROVE";
export const PHASE5_PUBLISH_CONNECTORS = ["youtube", "drive", "package"] as const;
export const PHASE5_PUBLISH_VISIBILITY = ["private", "unlisted", "public"] as const;
export type Phase5PublishConnector = (typeof PHASE5_PUBLISH_CONNECTORS)[number];
export type Phase5PublishVisibility = (typeof PHASE5_PUBLISH_VISIBILITY)[number];

export type ReviewApprovalRole = "OWNER" | "ADMIN" | "EDITOR";
export type ReviewApprovalChainStep = {
  id: string;
  role: ReviewApprovalRole;
  label: string;
  required: boolean;
  order: number;
};

export type BrandStudioBrandKit = {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontFamily: string | null;
  logoAssetId: string | null;
  watermarkAssetId: string | null;
};

export type BrandStudioFontAsset = {
  id: string;
  name: string;
  family: string;
  weight: number | null;
  style: "normal" | "italic";
  format: "ttf" | "otf" | "woff" | "woff2";
  assetId: string | null;
  url: string | null;
  isVariable: boolean;
  fallback: string | null;
};

export type BrandStudioLayoutPack = {
  id: string;
  name: string;
  aspectRatio: string;
  sceneLayoutIds: string[];
  tags: string[];
  isDefault: boolean;
};

export type BrandStudioTemplatePack = {
  id: string;
  name: string;
  category: string;
  layoutPackId: string | null;
  captionStylePresetId: string | null;
  audioPreset: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
};

export type BrandStudioDistributionPreset = {
  id: string;
  name: string;
  connector: Phase5PublishConnector | "all";
  visibility: Phase5PublishVisibility | null;
  titleTemplate: string | null;
  descriptionTemplate: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  isDefault: boolean;
};

export type BrandStudioMetadataPack = {
  id: string;
  name: string;
  connector: Phase5PublishConnector | "all";
  metadata: Record<string, unknown>;
  tags: string[];
};

export type NormalizedBrandStudioMetadata = {
  brandKit: BrandStudioBrandKit;
  customFonts: BrandStudioFontAsset[];
  layoutPacks: BrandStudioLayoutPack[];
  templatePacks: BrandStudioTemplatePack[];
  distributionPresets: BrandStudioDistributionPreset[];
  metadataPacks: BrandStudioMetadataPack[];
  metadata: Record<string, unknown>;
};

type ReviewDecisionLike = {
  status: "APPROVED" | "REJECTED";
  revisionId: string | null;
};

const SCOPE_RANK: Record<Phase5ShareScope, number> = {
  VIEW: 1,
  COMMENT: 2,
  APPROVE: 3
};

const REVIEW_APPROVAL_ROLES = ["OWNER", "ADMIN", "EDITOR"] as const;
const FONT_FORMATS = ["ttf", "otf", "woff", "woff2"] as const;

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asTrimmedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}

function asSanitizedTags(input: unknown, maxItems: number) {
  if (!Array.isArray(input)) {
    return [] as string[];
  }
  return Array.from(
    new Set(
      input
        .map((tag) => (typeof tag === "string" ? tag.trim().toLowerCase() : ""))
        .filter((tag) => tag.length >= 2 && tag.length <= 32)
    )
  ).slice(0, maxItems);
}

function asConnector(value: unknown, fallback: Phase5PublishConnector | "all") {
  if (value === "all") {
    return "all" as const;
  }
  return PHASE5_PUBLISH_CONNECTORS.includes(value as Phase5PublishConnector)
    ? (value as Phase5PublishConnector)
    : fallback;
}

function asVisibility(value: unknown, fallback: Phase5PublishVisibility | null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return PHASE5_PUBLISH_VISIBILITY.includes(value as Phase5PublishVisibility)
    ? (value as Phase5PublishVisibility)
    : fallback;
}

function asStableId(value: unknown, prefix: string, index: number) {
  const candidate = asTrimmedString(value, 80);
  return candidate ?? `${prefix}_${index + 1}`;
}

function normalizeBrandKit(rawMetadata: Record<string, unknown>): BrandStudioBrandKit {
  const source = asRecord(rawMetadata.brandKit);
  return {
    primaryColor: asTrimmedString(source.primaryColor, 24),
    secondaryColor: asTrimmedString(source.secondaryColor, 24),
    accentColor: asTrimmedString(source.accentColor, 24),
    fontFamily: asTrimmedString(source.fontFamily, 120),
    logoAssetId: asTrimmedString(source.logoAssetId, 120),
    watermarkAssetId: asTrimmedString(source.watermarkAssetId, 120)
  };
}

function normalizeCustomFonts(rawMetadata: Record<string, unknown>) {
  const fonts = Array.isArray(rawMetadata.customFonts) ? rawMetadata.customFonts : [];
  const normalized = fonts
    .map((entry, index) => {
      const source = asRecord(entry);
      const style = source.style === "italic" ? "italic" : "normal";
      const format = FONT_FORMATS.includes(source.format as (typeof FONT_FORMATS)[number])
        ? (source.format as (typeof FONT_FORMATS)[number])
        : "woff2";
      const weight = typeof source.weight === "number" && Number.isFinite(source.weight)
        ? Math.max(100, Math.min(900, Math.trunc(source.weight)))
        : null;
      const name = asTrimmedString(source.name, 120) ?? `Brand Font ${index + 1}`;
      return {
        id: asStableId(source.id, "font", index),
        name,
        family: asTrimmedString(source.family, 120) ?? name,
        weight,
        style,
        format,
        assetId: asTrimmedString(source.assetId, 120),
        url: asTrimmedString(source.url, 2048),
        isVariable: source.isVariable === true,
        fallback: asTrimmedString(source.fallback, 120)
      } as BrandStudioFontAsset;
    })
    .slice(0, 50);

  return Array.from(new Map(normalized.map((font) => [font.id, font])).values());
}

function normalizeLayoutPacks(rawMetadata: Record<string, unknown>) {
  const packs = Array.isArray(rawMetadata.layoutPacks) ? rawMetadata.layoutPacks : [];
  const normalized = packs
    .map((entry, index) => {
      const source = asRecord(entry);
      const sceneLayoutIds = Array.isArray(source.sceneLayoutIds)
        ? source.sceneLayoutIds
            .map((id) => asTrimmedString(id, 120))
            .filter((id): id is string => Boolean(id))
            .slice(0, 40)
        : [];
      return {
        id: asStableId(source.id, "layout", index),
        name: asTrimmedString(source.name, 120) ?? `Layout Pack ${index + 1}`,
        aspectRatio: asTrimmedString(source.aspectRatio, 16) ?? "9:16",
        sceneLayoutIds: Array.from(new Set(sceneLayoutIds)),
        tags: asSanitizedTags(source.tags, 20),
        isDefault: source.isDefault === true
      } as BrandStudioLayoutPack;
    })
    .slice(0, 40);

  if (normalized.length === 0) {
    return [
      {
        id: "layout_default_vertical",
        name: "Default Vertical",
        aspectRatio: "9:16",
        sceneLayoutIds: ["intro", "speaker", "cta"],
        tags: ["default", "shorts"],
        isDefault: true
      }
    ] satisfies BrandStudioLayoutPack[];
  }

  return Array.from(new Map(normalized.map((pack) => [pack.id, pack])).values());
}

function normalizeTemplatePacks(rawMetadata: Record<string, unknown>) {
  const templates = Array.isArray(rawMetadata.templatePacks) ? rawMetadata.templatePacks : [];
  const normalized = templates
    .map((entry, index) => {
      const source = asRecord(entry);
      return {
        id: asStableId(source.id, "template", index),
        name: asTrimmedString(source.name, 120) ?? `Template ${index + 1}`,
        category: asTrimmedString(source.category, 80) ?? "general",
        layoutPackId: asTrimmedString(source.layoutPackId, 80),
        captionStylePresetId: asTrimmedString(source.captionStylePresetId, 80),
        audioPreset: asTrimmedString(source.audioPreset, 64),
        tags: asSanitizedTags(source.tags, 20),
        metadata: asRecord(source.metadata)
      } as BrandStudioTemplatePack;
    })
    .slice(0, 80);

  return Array.from(new Map(normalized.map((template) => [template.id, template])).values());
}

function normalizeDistributionPresets(rawMetadata: Record<string, unknown>) {
  const presets = Array.isArray(rawMetadata.distributionPresets) ? rawMetadata.distributionPresets : [];
  const normalized = presets
    .map((entry, index) => {
      const source = asRecord(entry);
      return {
        id: asStableId(source.id, "distribution", index),
        name: asTrimmedString(source.name, 120) ?? `Distribution Preset ${index + 1}`,
        connector: asConnector(source.connector, "all"),
        visibility: asVisibility(source.visibility, null),
        titleTemplate: asTrimmedString(source.titleTemplate, 220),
        descriptionTemplate: asTrimmedString(source.descriptionTemplate, 4000),
        tags: asSanitizedTags(source.tags, 30),
        metadata: asRecord(source.metadata),
        isDefault: source.isDefault === true
      } as BrandStudioDistributionPreset;
    })
    .slice(0, 40);

  if (normalized.length === 0) {
    return [
      {
        id: "dist_default",
        name: "Default Distribution",
        connector: "all",
        visibility: null,
        titleTemplate: null,
        descriptionTemplate: null,
        tags: [],
        metadata: {},
        isDefault: true
      }
    ] satisfies BrandStudioDistributionPreset[];
  }

  return Array.from(new Map(normalized.map((preset) => [preset.id, preset])).values());
}

function normalizeMetadataPacks(rawMetadata: Record<string, unknown>) {
  const packs = Array.isArray(rawMetadata.metadataPacks) ? rawMetadata.metadataPacks : [];
  const normalized = packs
    .map((entry, index) => {
      const source = asRecord(entry);
      return {
        id: asStableId(source.id, "metadata_pack", index),
        name: asTrimmedString(source.name, 120) ?? `Metadata Pack ${index + 1}`,
        connector: asConnector(source.connector, "all"),
        metadata: asRecord(source.metadata),
        tags: asSanitizedTags(source.tags, 20)
      } as BrandStudioMetadataPack;
    })
    .slice(0, 80);

  return Array.from(new Map(normalized.map((pack) => [pack.id, pack])).values());
}

export function normalizeBrandStudioMetadata(input: unknown): NormalizedBrandStudioMetadata {
  const rawMetadata = asRecord(input);
  const brandKit = normalizeBrandKit(rawMetadata);
  const customFonts = normalizeCustomFonts(rawMetadata);
  const layoutPacks = normalizeLayoutPacks(rawMetadata);
  const templatePacks = normalizeTemplatePacks(rawMetadata);
  const distributionPresets = normalizeDistributionPresets(rawMetadata);
  const metadataPacks = normalizeMetadataPacks(rawMetadata);

  return {
    brandKit,
    customFonts,
    layoutPacks,
    templatePacks,
    distributionPresets,
    metadataPacks,
    metadata: {
      ...rawMetadata,
      brandKit,
      customFonts,
      layoutPacks,
      templatePacks,
      distributionPresets,
      metadataPacks
    }
  };
}

export function normalizeApprovalChain(input: unknown): ReviewApprovalChainStep[] {
  const chain = Array.isArray(input) ? input : [];
  const normalized = chain
    .map((step, index) => {
      const source = asRecord(step);
      const role = REVIEW_APPROVAL_ROLES.includes(source.role as ReviewApprovalRole)
        ? (source.role as ReviewApprovalRole)
        : "ADMIN";
      const order = typeof source.order === "number" && Number.isFinite(source.order)
        ? Math.max(1, Math.min(50, Math.trunc(source.order)))
        : index + 1;
      return {
        id: asStableId(source.id, `approval_${role.toLowerCase()}`, index),
        role,
        label: asTrimmedString(source.label, 120) ?? `${role} approval`,
        required: source.required !== false,
        order
      } as ReviewApprovalChainStep;
    })
    .slice(0, 8)
    .sort((a, b) => a.order - b.order);

  if (normalized.length === 0) {
    return [
      {
        id: "approval_admin_primary",
        role: "ADMIN",
        label: "Admin approval",
        required: true,
        order: 1
      }
    ];
  }

  return Array.from(new Map(normalized.map((step) => [step.id, step])).values());
}

export function buildApprovalChainState(params: {
  chain: ReviewApprovalChainStep[];
  decisions: Array<{
    status: "APPROVED" | "REJECTED";
    metadata?: unknown;
    decidedByUserId?: string | null;
    createdAt?: string;
  }>;
}) {
  const chain = normalizeApprovalChain(params.chain);
  const byStepId = new Map<string, { status: "APPROVED" | "REJECTED"; decidedByUserId: string | null; createdAt: string | null }>();

  for (const decision of params.decisions) {
    const decisionMetadata = asRecord(decision.metadata);
    const stepId = asTrimmedString(decisionMetadata.approvalChainStepId, 80);
    const existing = stepId ? byStepId.get(stepId) : null;
    if (!stepId || existing) {
      continue;
    }
    byStepId.set(stepId, {
      status: decision.status,
      decidedByUserId: decision.decidedByUserId ?? null,
      createdAt: decision.createdAt ?? null
    });
  }

  const steps = chain.map((step) => {
    const decision = byStepId.get(step.id) ?? null;
    return {
      ...step,
      status: decision?.status ?? "PENDING",
      decidedByUserId: decision?.decidedByUserId ?? null,
      decidedAt: decision?.createdAt ?? null
    };
  });

  const requiredSteps = steps.filter((step) => step.required);
  const completedRequiredCount = requiredSteps.filter((step) => step.status === "APPROVED").length;
  const hasRejection = requiredSteps.some((step) => step.status === "REJECTED");
  const nextRequiredStep = requiredSteps.find((step) => step.status === "PENDING") ?? null;

  return {
    steps,
    totalRequiredCount: requiredSteps.length,
    completedRequiredCount,
    hasRejection,
    isComplete: requiredSteps.length > 0 && completedRequiredCount === requiredSteps.length,
    nextRequiredStepId: nextRequiredStep?.id ?? null
  };
}

export function hasShareScope(current: Phase5ShareScope, required: Phase5ShareScope) {
  return SCOPE_RANK[current] >= SCOPE_RANK[required];
}

export function clampInt(input: number, min: number, max: number) {
  if (!Number.isFinite(input)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(input)));
}

export function normalizeCommentAnchor(input: {
  anchorMs?: number | null;
  transcriptStartMs?: number | null;
  transcriptEndMs?: number | null;
}) {
  const anchorMs = typeof input.anchorMs === "number" ? Math.max(0, Math.trunc(input.anchorMs)) : null;
  const start = typeof input.transcriptStartMs === "number" ? Math.max(0, Math.trunc(input.transcriptStartMs)) : null;
  const end = typeof input.transcriptEndMs === "number" ? Math.max(0, Math.trunc(input.transcriptEndMs)) : null;
  if (start !== null && end !== null) {
    return {
      anchorMs,
      transcriptStartMs: Math.min(start, end),
      transcriptEndMs: Math.max(start, end)
    };
  }
  return {
    anchorMs,
    transcriptStartMs: start,
    transcriptEndMs: end
  };
}

export function evaluateApprovalGate(params: {
  approvalRequired: boolean;
  currentRevisionId: string | null;
  latestDecision: ReviewDecisionLike | null;
}) {
  if (!params.approvalRequired) {
    return {
      allowed: true,
      reason: null as string | null
    };
  }
  if (!params.currentRevisionId) {
    return {
      allowed: false,
      reason: "Render approval required but no current revision is available."
    };
  }
  if (!params.latestDecision) {
    return {
      allowed: false,
      reason: "Render approval required before final render."
    };
  }
  if (params.latestDecision.status !== "APPROVED") {
    return {
      allowed: false,
      reason: "Latest review decision is not approved."
    };
  }
  if (params.latestDecision.revisionId !== params.currentRevisionId) {
    return {
      allowed: false,
      reason: "Current revision changed after approval. Re-approve before rendering."
    };
  }
  return {
    allowed: true,
    reason: null as string | null
  };
}

export function buildProjectShareUrl(baseUrl: string, projectV2Id: string, token: string) {
  const normalized = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}/opencut/projects-v2/${projectV2Id}?shareToken=${encodeURIComponent(token)}`;
}

export function buildReviewerPageUrl(baseUrl: string, projectV2Id: string, token: string) {
  const shareUrl = buildProjectShareUrl(baseUrl, projectV2Id, token);
  return `${shareUrl}&reviewerPage=1`;
}

export function normalizeBrandPresetInput(input: {
  name?: string | null;
  captionStylePresetId?: string | null;
  audioPreset?: string | null;
  defaultConnector?: string | null;
  defaultVisibility?: string | null;
  defaultTitlePrefix?: string | null;
  defaultTags?: string[] | null;
  metadata?: Record<string, unknown> | null;
}) {
  const connector = PHASE5_PUBLISH_CONNECTORS.includes((input.defaultConnector ?? "") as Phase5PublishConnector)
    ? (input.defaultConnector as Phase5PublishConnector)
    : "package";
  const visibility = PHASE5_PUBLISH_VISIBILITY.includes((input.defaultVisibility ?? "") as Phase5PublishVisibility)
    ? (input.defaultVisibility as Phase5PublishVisibility)
    : "private";
  const tags = (input.defaultTags ?? [])
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length >= 2 && tag.length <= 32)
    .slice(0, 12);
  const normalizedMetadata = normalizeBrandStudioMetadata(input.metadata ?? {});
  return {
    name: (input.name ?? "Default Brand Preset").trim().slice(0, 120) || "Default Brand Preset",
    captionStylePresetId: input.captionStylePresetId?.trim() || null,
    audioPreset: input.audioPreset?.trim().slice(0, 64) || null,
    defaultConnector: connector,
    defaultVisibility: visibility,
    defaultTitlePrefix: input.defaultTitlePrefix?.trim().slice(0, 120) || null,
    defaultTags: Array.from(new Set(tags)),
    metadata: normalizedMetadata.metadata
  };
}
