export type Phase5ShareScope = "VIEW" | "COMMENT" | "APPROVE";
export const PHASE5_PUBLISH_CONNECTORS = ["youtube", "drive", "package"] as const;
export const PHASE5_PUBLISH_VISIBILITY = ["private", "unlisted", "public"] as const;
export type Phase5PublishConnector = (typeof PHASE5_PUBLISH_CONNECTORS)[number];
export type Phase5PublishVisibility = (typeof PHASE5_PUBLISH_VISIBILITY)[number];

type ReviewDecisionLike = {
  status: "APPROVED" | "REJECTED";
  revisionId: string | null;
};

const SCOPE_RANK: Record<Phase5ShareScope, number> = {
  VIEW: 1,
  COMMENT: 2,
  APPROVE: 3
};

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
  return {
    name: (input.name ?? "Default Brand Preset").trim().slice(0, 120) || "Default Brand Preset",
    captionStylePresetId: input.captionStylePresetId?.trim() || null,
    audioPreset: input.audioPreset?.trim().slice(0, 64) || null,
    defaultConnector: connector,
    defaultVisibility: visibility,
    defaultTitlePrefix: input.defaultTitlePrefix?.trim().slice(0, 120) || null,
    defaultTags: Array.from(new Set(tags)),
    metadata: input.metadata ?? {}
  };
}
