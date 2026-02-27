import { clampInt } from "@/lib/review-phase5-tools";

export type DesktopDropFileInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec?: number | null;
  sourcePath?: string | null;
};

export type DesktopDropIngestPlan = {
  accepted: Array<{
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    slot: "primary" | "broll" | "audio";
    reason: string;
  }>;
  rejected: Array<{
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    reason: string;
  }>;
  summary: {
    total: number;
    accepted: number;
    rejected: number;
  };
};

const VIDEO_MIME_PREFIX = "video/";
const IMAGE_MIME_PREFIX = "image/";
const AUDIO_MIME_PREFIX = "audio/";

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function extractExtension(fileName: string) {
  const normalized = normalizeName(fileName);
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === normalized.length - 1) {
    return "";
  }
  return normalized.slice(dotIndex + 1);
}

function basenameNoExt(fileName: string) {
  const normalized = normalizeName(fileName).replace(/\\/g, "/");
  const segment = normalized.split("/").at(-1) ?? normalized;
  const dotIndex = segment.lastIndexOf(".");
  if (dotIndex <= 0) {
    return segment;
  }
  return segment.slice(0, dotIndex);
}

export function buildDesktopDropIngestPlan(params: {
  files: DesktopDropFileInput[];
  maxUploadMb: number;
}): DesktopDropIngestPlan {
  const maxBytes = Math.max(1, Math.trunc(params.maxUploadMb * 1024 * 1024));
  const accepted: DesktopDropIngestPlan["accepted"] = [];
  const rejected: DesktopDropIngestPlan["rejected"] = [];

  for (const file of params.files.slice(0, 50)) {
    const fileName = file.fileName.trim().slice(0, 240);
    const mimeType = file.mimeType.trim().toLowerCase();
    const sizeBytes = Math.max(0, Math.trunc(file.sizeBytes));

    if (!fileName) {
      rejected.push({
        fileName: "unnamed",
        mimeType,
        sizeBytes,
        reason: "Missing file name"
      });
      continue;
    }

    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      rejected.push({
        fileName,
        mimeType,
        sizeBytes,
        reason: "Invalid file size"
      });
      continue;
    }

    if (sizeBytes > maxBytes) {
      rejected.push({
        fileName,
        mimeType,
        sizeBytes,
        reason: `File exceeds upload limit (${params.maxUploadMb}MB)`
      });
      continue;
    }

    const slot = mimeType.startsWith(VIDEO_MIME_PREFIX)
      ? "primary"
      : mimeType.startsWith(IMAGE_MIME_PREFIX)
        ? "broll"
        : mimeType.startsWith(AUDIO_MIME_PREFIX)
          ? "audio"
          : null;

    if (!slot) {
      rejected.push({
        fileName,
        mimeType,
        sizeBytes,
        reason: "Unsupported media type"
      });
      continue;
    }

    accepted.push({
      fileName,
      mimeType,
      sizeBytes,
      slot,
      reason: slot === "primary" ? "Ready for timeline ingest" : "Ready for media rail"
    });
  }

  return {
    accepted,
    rejected,
    summary: {
      total: accepted.length + rejected.length,
      accepted: accepted.length,
      rejected: rejected.length
    }
  };
}

export type DesktopOfflineDraft = {
  draftId: string;
  clientId: string;
  basedOnRevisionId: string | null;
  operations: Array<Record<string, unknown>>;
  status: "IN_SYNC" | "DIRTY" | "CONFLICT";
  updatedAt: string;
};

export function normalizeDesktopOfflineDrafts(input: {
  drafts: DesktopOfflineDraft[];
  currentRevisionId: string | null;
}): DesktopOfflineDraft[] {
  return input.drafts
    .map((draft) => {
      const status: DesktopOfflineDraft["status"] = draft.operations.length === 0
        ? "IN_SYNC"
        : (draft.basedOnRevisionId && input.currentRevisionId && draft.basedOnRevisionId !== input.currentRevisionId)
          ? "CONFLICT"
          : "DIRTY";
      return {
        ...draft,
        status
      };
    })
    .slice(0, 30);
}

export function mergeDesktopOfflineDrafts(params: {
  existingDrafts: DesktopOfflineDraft[];
  mutation: {
    draftId: string;
    clientId: string;
    basedOnRevisionId?: string | null;
    operations?: Array<Record<string, unknown>>;
    clear?: boolean;
    updatedAt?: string;
  };
  currentRevisionId: string | null;
}): {
  drafts: DesktopOfflineDraft[];
  summary: {
    total: number;
    dirty: number;
    conflict: number;
    inSync: number;
  };
} {
  const nowIso = params.mutation.updatedAt ?? new Date().toISOString();
  const map = new Map(params.existingDrafts.map((draft) => [draft.draftId, draft]));
  const existing = map.get(params.mutation.draftId);

  const basedOnRevisionId = params.mutation.basedOnRevisionId === undefined
    ? (existing?.basedOnRevisionId ?? null)
    : params.mutation.basedOnRevisionId;

  const operations = params.mutation.clear
    ? []
    : (params.mutation.operations ?? existing?.operations ?? [])
      .filter((entry) => entry && typeof entry === "object")
      .slice(0, 500);

  const status: DesktopOfflineDraft["status"] = operations.length === 0
    ? "IN_SYNC"
    : (basedOnRevisionId && params.currentRevisionId && basedOnRevisionId !== params.currentRevisionId)
      ? "CONFLICT"
      : "DIRTY";

  map.set(params.mutation.draftId, {
    draftId: params.mutation.draftId,
    clientId: params.mutation.clientId,
    basedOnRevisionId,
    operations,
    status,
    updatedAt: nowIso
  });

  const drafts = [...map.values()]
    .map((draft): DesktopOfflineDraft => {
      const derivedStatus: DesktopOfflineDraft["status"] = draft.operations.length === 0
        ? "IN_SYNC"
        : (draft.basedOnRevisionId && params.currentRevisionId && draft.basedOnRevisionId !== params.currentRevisionId)
          ? "CONFLICT"
          : "DIRTY";
      return {
        ...draft,
        status: derivedStatus
      };
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 30);

  return {
    drafts,
    summary: {
      total: drafts.length,
      dirty: drafts.filter((draft) => draft.status === "DIRTY").length,
      conflict: drafts.filter((draft) => draft.status === "CONFLICT").length,
      inSync: drafts.filter((draft) => draft.status === "IN_SYNC").length
    }
  };
}

export type DesktopMissingAsset = {
  assetId: string;
  originalFileName: string;
  expectedDurationSec?: number | null;
  expectedSizeBytes?: number | null;
};

export type DesktopRelinkCandidate = {
  candidateId?: string;
  fileName: string;
  absolutePath: string;
  durationSec?: number | null;
  sizeBytes?: number | null;
};

export type DesktopRelinkRecommendation = {
  assetId: string;
  status: "MATCHED" | "UNMATCHED";
  selectedCandidate: {
    candidateId: string;
    fileName: string;
    absolutePath: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    score: number;
  } | null;
  alternatives: Array<{
    candidateId: string;
    fileName: string;
    absolutePath: string;
    score: number;
  }>;
};

function scoreRelinkMatch(asset: DesktopMissingAsset, candidate: DesktopRelinkCandidate) {
  const assetBase = basenameNoExt(asset.originalFileName);
  const candidateBase = basenameNoExt(candidate.fileName);
  const assetExt = extractExtension(asset.originalFileName);
  const candidateExt = extractExtension(candidate.fileName);

  let score = 0;
  if (normalizeName(asset.originalFileName) === normalizeName(candidate.fileName)) {
    score += 80;
  } else if (assetBase === candidateBase) {
    score += 60;
  } else if (assetBase.includes(candidateBase) || candidateBase.includes(assetBase)) {
    score += 30;
  }

  if (assetExt && candidateExt && assetExt === candidateExt) {
    score += 10;
  }

  if (typeof asset.expectedDurationSec === "number" && typeof candidate.durationSec === "number") {
    const delta = Math.abs(asset.expectedDurationSec - candidate.durationSec);
    score += delta <= 0.5 ? 20 : delta <= 2 ? 10 : delta <= 5 ? 4 : 0;
  }

  if (typeof asset.expectedSizeBytes === "number" && typeof candidate.sizeBytes === "number") {
    const maxSize = Math.max(asset.expectedSizeBytes, 1);
    const ratio = Math.abs(asset.expectedSizeBytes - candidate.sizeBytes) / maxSize;
    score += ratio <= 0.1 ? 12 : ratio <= 0.25 ? 6 : ratio <= 0.5 ? 3 : 0;
  }

  return clampInt(score, 0, 100);
}

function confidenceFromScore(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 80) {
    return "HIGH";
  }
  if (score >= 55) {
    return "MEDIUM";
  }
  return "LOW";
}

export function recommendDesktopMediaRelink(params: {
  missingAssets: DesktopMissingAsset[];
  candidates: DesktopRelinkCandidate[];
}): {
  recommendations: DesktopRelinkRecommendation[];
  summary: {
    totalMissing: number;
    matched: number;
    unmatched: number;
    highConfidenceMatches: number;
  };
} {
  const recommendations = params.missingAssets.slice(0, 200).map((asset) => {
    const scored = params.candidates
      .slice(0, 1000)
      .map((candidate, index) => {
        const score = scoreRelinkMatch(asset, candidate);
        return {
          candidateId: candidate.candidateId?.trim() || `candidate_${index + 1}`,
          fileName: candidate.fileName,
          absolutePath: candidate.absolutePath,
          score
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const best = scored[0] ?? null;
    const matched = Boolean(best && best.score >= 55);

    return {
      assetId: asset.assetId,
      status: matched ? "MATCHED" : "UNMATCHED",
      selectedCandidate: matched && best
        ? {
            ...best,
            confidence: confidenceFromScore(best.score)
          }
        : null,
      alternatives: scored
    } satisfies DesktopRelinkRecommendation;
  });

  const matched = recommendations.filter((entry) => entry.status === "MATCHED").length;
  return {
    recommendations,
    summary: {
      totalMissing: recommendations.length,
      matched,
      unmatched: recommendations.length - matched,
      highConfidenceMatches: recommendations.filter((entry) => entry.selectedCandidate?.confidence === "HIGH").length
    }
  };
}

export type DesktopNotification = {
  id: string;
  kind: "UPLOAD" | "RENDER" | "RELINK" | "OFFLINE_DRAFT" | "SYSTEM";
  severity: "INFO" | "WARN" | "CRITICAL";
  title: string;
  body: string;
  createdAt: string;
  action: {
    type: "OPEN_PANEL" | "OPEN_SETTINGS" | "OPEN_PROJECT";
    payload: string;
  };
};

export function buildDesktopNotificationQueue(input: {
  recentEvents: Array<{
    id: string;
    event: string;
    outcome: string;
    createdAt: string;
    metadata?: unknown;
  }>;
  relinkSummary?: {
    unmatched: number;
  } | null;
  offlineDraftSummary?: {
    conflict: number;
  } | null;
}) {
  const notifications: DesktopNotification[] = [];

  for (const event of input.recentEvents.slice(0, 40)) {
    const normalizedEvent = event.event.startsWith("desktop.") ? event.event.slice("desktop.".length) : event.event;

    if (normalizedEvent === "background_upload_notice") {
      notifications.push({
        id: `upload_${event.id}`,
        kind: "UPLOAD",
        severity: event.outcome === "ERROR" ? "WARN" : "INFO",
        title: event.outcome === "ERROR" ? "Upload issue detected" : "Upload finished",
        body: event.outcome === "ERROR" ? "One or more uploads failed in background sync." : "Background upload completed successfully.",
        createdAt: event.createdAt,
        action: {
          type: "OPEN_PANEL",
          payload: "uploads"
        }
      });
    }

    if (normalizedEvent === "background_render_notice") {
      notifications.push({
        id: `render_${event.id}`,
        kind: "RENDER",
        severity: event.outcome === "ERROR" ? "WARN" : "INFO",
        title: event.outcome === "ERROR" ? "Render failed" : "Render completed",
        body: event.outcome === "ERROR" ? "Desktop render failed. Open render panel for details." : "Render output is ready for export.",
        createdAt: event.createdAt,
        action: {
          type: "OPEN_PANEL",
          payload: "render"
        }
      });
    }

    if (normalizedEvent === "native_crash" || normalizedEvent === "app_crash") {
      notifications.push({
        id: `crash_${event.id}`,
        kind: "SYSTEM",
        severity: "CRITICAL",
        title: "Desktop app recovered from crash",
        body: "A crash report was captured. Review diagnostics before continuing.",
        createdAt: event.createdAt,
        action: {
          type: "OPEN_SETTINGS",
          payload: "diagnostics"
        }
      });
    }
  }

  if ((input.relinkSummary?.unmatched ?? 0) > 0) {
    notifications.push({
      id: "relink_pending",
      kind: "RELINK",
      severity: "WARN",
      title: "Media relink required",
      body: `${input.relinkSummary?.unmatched ?? 0} assets need relink before export.`,
      createdAt: new Date().toISOString(),
      action: {
        type: "OPEN_PANEL",
        payload: "media-relink"
      }
    });
  }

  if ((input.offlineDraftSummary?.conflict ?? 0) > 0) {
    notifications.push({
      id: "offline_conflicts",
      kind: "OFFLINE_DRAFT",
      severity: "WARN",
      title: "Offline draft conflicts",
      body: `${input.offlineDraftSummary?.conflict ?? 0} offline drafts need conflict resolution.`,
      createdAt: new Date().toISOString(),
      action: {
        type: "OPEN_PANEL",
        payload: "offline-drafts"
      }
    });
  }

  return notifications.slice(0, 40);
}
