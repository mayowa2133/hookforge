import { Prisma } from "@prisma/client";
import { requireProjectContext } from "@/lib/api-context";
import { prisma } from "@/lib/prisma";
import {
  buildDesktopDropIngestPlan,
  buildDesktopNotificationQueue,
  mergeDesktopOfflineDrafts,
  normalizeDesktopOfflineDrafts,
  recommendDesktopMediaRelink,
  type DesktopDropFileInput,
  type DesktopOfflineDraft,
  type DesktopRelinkCandidate,
  type DesktopMissingAsset
} from "@/lib/desktop/workflows";

type DesktopProjectState = {
  offlineDrafts: DesktopOfflineDraft[];
  relinkHistory: Array<{
    id: string;
    createdAt: string;
    summary: {
      totalMissing: number;
      matched: number;
      unmatched: number;
      highConfidenceMatches: number;
    };
    recommendations: Array<{
      assetId: string;
      status: "MATCHED" | "UNMATCHED";
      selectedCandidate: {
        candidateId: string;
        fileName: string;
        absolutePath: string;
        confidence: "HIGH" | "MEDIUM" | "LOW";
        score: number;
      } | null;
    }>;
  }>;
  acknowledgedNotificationIds: string[];
  updatedAt: string;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeOfflineDraft(input: unknown): DesktopOfflineDraft | null {
  const raw = asRecord(input);
  const draftId = typeof raw.draftId === "string" ? raw.draftId.trim() : "";
  const clientId = typeof raw.clientId === "string" ? raw.clientId.trim() : "";
  if (!draftId || !clientId) {
    return null;
  }
  const operations = Array.isArray(raw.operations)
    ? raw.operations.filter((entry) => entry && typeof entry === "object").slice(0, 500) as Array<Record<string, unknown>>
    : [];
  const status = raw.status === "IN_SYNC" || raw.status === "DIRTY" || raw.status === "CONFLICT"
    ? raw.status
    : "IN_SYNC";
  const basedOnRevisionId = typeof raw.basedOnRevisionId === "string" && raw.basedOnRevisionId.trim().length > 0
    ? raw.basedOnRevisionId.trim()
    : null;
  const updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt.length > 0
    ? raw.updatedAt
    : new Date(0).toISOString();

  return {
    draftId,
    clientId,
    basedOnRevisionId,
    operations,
    status,
    updatedAt
  };
}

function loadDesktopProjectState(configInput: unknown): DesktopProjectState {
  const config = asRecord(configInput);
  const desktop = asRecord(config.desktop);

  const offlineDrafts = Array.isArray(desktop.offlineDrafts)
    ? desktop.offlineDrafts
        .map(normalizeOfflineDraft)
        .filter((entry): entry is DesktopOfflineDraft => Boolean(entry))
        .slice(0, 30)
    : [];

  const relinkHistory = Array.isArray(desktop.relinkHistory)
    ? desktop.relinkHistory
        .map((entry) => {
          const raw = asRecord(entry);
          const summaryRaw = asRecord(raw.summary);
          const recommendations: DesktopProjectState["relinkHistory"][number]["recommendations"] = Array.isArray(raw.recommendations)
            ? raw.recommendations
                .map((recommendation) => {
                  const rec = asRecord(recommendation);
                  if (typeof rec.assetId !== "string") {
                    return null;
                  }
                  const selectedRaw = asRecord(rec.selectedCandidate);
                  const selectedCandidate = typeof selectedRaw.candidateId === "string"
                    ? {
                        candidateId: selectedRaw.candidateId,
                        fileName: typeof selectedRaw.fileName === "string" ? selectedRaw.fileName : "",
                        absolutePath: typeof selectedRaw.absolutePath === "string" ? selectedRaw.absolutePath : "",
                        confidence: selectedRaw.confidence === "HIGH" || selectedRaw.confidence === "MEDIUM" || selectedRaw.confidence === "LOW"
                          ? selectedRaw.confidence as "HIGH" | "MEDIUM" | "LOW"
                          : "LOW",
                        score: typeof selectedRaw.score === "number" ? selectedRaw.score : 0
                      }
                    : null;
                  return {
                    assetId: rec.assetId,
                    status: (rec.status === "MATCHED" ? "MATCHED" : "UNMATCHED") as "MATCHED" | "UNMATCHED",
                    selectedCandidate
                  };
                })
                .filter((item): item is NonNullable<typeof item> => Boolean(item))
                .slice(0, 200)
            : [];
          return {
            id: typeof raw.id === "string" ? raw.id : `relink_${Date.now()}`,
            createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
            summary: {
              totalMissing: typeof summaryRaw.totalMissing === "number" ? summaryRaw.totalMissing : recommendations.length,
              matched: typeof summaryRaw.matched === "number" ? summaryRaw.matched : recommendations.filter((item) => item.status === "MATCHED").length,
              unmatched: typeof summaryRaw.unmatched === "number" ? summaryRaw.unmatched : recommendations.filter((item) => item.status === "UNMATCHED").length,
              highConfidenceMatches: typeof summaryRaw.highConfidenceMatches === "number" ? summaryRaw.highConfidenceMatches : recommendations.filter((item) => item.selectedCandidate?.confidence === "HIGH").length
            },
            recommendations
          };
        })
        .slice(0, 30)
    : [];

  const acknowledgedNotificationIds = Array.isArray(desktop.acknowledgedNotificationIds)
    ? desktop.acknowledgedNotificationIds
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .slice(0, 400)
    : [];

  return {
    offlineDrafts,
    relinkHistory,
    acknowledgedNotificationIds,
    updatedAt: typeof desktop.updatedAt === "string" ? desktop.updatedAt : new Date(0).toISOString()
  };
}

async function saveDesktopProjectState(params: {
  legacyProjectId: string;
  existingConfig: unknown;
  nextState: DesktopProjectState;
}) {
  const existingConfig = asRecord(params.existingConfig);
  const nextConfig = {
    ...existingConfig,
    desktop: {
      offlineDrafts: params.nextState.offlineDrafts,
      relinkHistory: params.nextState.relinkHistory,
      acknowledgedNotificationIds: params.nextState.acknowledgedNotificationIds,
      updatedAt: params.nextState.updatedAt
    }
  };

  await prisma.project.update({
    where: { id: params.legacyProjectId },
    data: {
      config: nextConfig as never
    }
  });
}

async function trackDesktopWorkflowEvent(params: {
  workspaceId: string;
  projectV2Id: string;
  userId: string;
  event: string;
  outcome: "SUCCESS" | "ERROR" | "INFO";
  metadata: Record<string, unknown>;
}) {
  await prisma.qualityFeedback.create({
    data: {
      workspaceId: params.workspaceId,
      projectId: params.projectV2Id,
      category: `desktop.${params.event}`,
      comment: params.outcome,
      metadata: {
        outcome: params.outcome,
        ...params.metadata
      } as Prisma.InputJsonValue,
      createdByUserId: params.userId
    }
  });
}

export async function getProjectDesktopOfflineDrafts(projectIdOrV2Id: string) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const state = loadDesktopProjectState(ctx.legacyProject.config);
  const drafts = normalizeDesktopOfflineDrafts({
    drafts: state.offlineDrafts,
    currentRevisionId: ctx.projectV2.currentRevisionId
  });

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    currentRevisionId: ctx.projectV2.currentRevisionId,
    drafts,
    summary: {
      total: drafts.length,
      dirty: drafts.filter((draft) => draft.status === "DIRTY").length,
      conflict: drafts.filter((draft) => draft.status === "CONFLICT").length,
      inSync: drafts.filter((draft) => draft.status === "IN_SYNC").length
    },
    updatedAt: state.updatedAt
  };
}

export async function upsertProjectDesktopOfflineDraft(params: {
  projectIdOrV2Id: string;
  draftId: string;
  clientId: string;
  basedOnRevisionId?: string | null;
  operations?: Array<Record<string, unknown>>;
  clear?: boolean;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const state = loadDesktopProjectState(ctx.legacyProject.config);
  const merged = mergeDesktopOfflineDrafts({
    existingDrafts: state.offlineDrafts,
    mutation: {
      draftId: params.draftId,
      clientId: params.clientId,
      basedOnRevisionId: params.basedOnRevisionId,
      operations: params.operations,
      clear: params.clear
    },
    currentRevisionId: ctx.projectV2.currentRevisionId
  });

  const nextState: DesktopProjectState = {
    ...state,
    offlineDrafts: merged.drafts,
    updatedAt: new Date().toISOString()
  };

  await saveDesktopProjectState({
    legacyProjectId: ctx.legacyProject.id,
    existingConfig: ctx.legacyProject.config,
    nextState
  });

  const newDraft = merged.drafts.find((draft) => draft.draftId === params.draftId) ?? null;
  await trackDesktopWorkflowEvent({
    workspaceId: ctx.workspace.id,
    projectV2Id: ctx.projectV2.id,
    userId: ctx.user.id,
    event: "offline_draft_sync",
    outcome: newDraft?.status === "CONFLICT" ? "ERROR" : "SUCCESS",
    metadata: {
      draftId: params.draftId,
      status: newDraft?.status ?? "IN_SYNC",
      operationCount: newDraft?.operations.length ?? 0
    }
  });

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    currentRevisionId: ctx.projectV2.currentRevisionId,
    draft: newDraft,
    drafts: merged.drafts,
    summary: merged.summary,
    updatedAt: nextState.updatedAt
  };
}

export async function planProjectDesktopDropIngest(params: {
  projectIdOrV2Id: string;
  files: DesktopDropFileInput[];
  maxUploadMb: number;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const plan = buildDesktopDropIngestPlan({
    files: params.files,
    maxUploadMb: params.maxUploadMb
  });

  await trackDesktopWorkflowEvent({
    workspaceId: ctx.workspace.id,
    projectV2Id: ctx.projectV2.id,
    userId: ctx.user.id,
    event: "drag_drop_ingest",
    outcome: plan.summary.rejected > 0 ? "INFO" : "SUCCESS",
    metadata: {
      total: plan.summary.total,
      accepted: plan.summary.accepted,
      rejected: plan.summary.rejected
    }
  });

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    ingestPlan: plan,
    nextStep: {
      presignEndpoint: `/api/projects/${ctx.legacyProject.id}/assets/presign`,
      registerEndpoint: `/api/projects-v2/${ctx.projectV2.id}/media/register`
    }
  };
}

export async function recommendProjectDesktopMediaRelink(params: {
  projectIdOrV2Id: string;
  missingAssets: DesktopMissingAsset[];
  candidates: DesktopRelinkCandidate[];
  apply?: boolean;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const state = loadDesktopProjectState(ctx.legacyProject.config);

  const recommended = recommendDesktopMediaRelink({
    missingAssets: params.missingAssets,
    candidates: params.candidates
  });

  if (params.apply) {
    const nowIso = new Date().toISOString();
    const entry = {
      id: `relink_${Date.now()}`,
      createdAt: nowIso,
      summary: recommended.summary,
      recommendations: recommended.recommendations.map((item) => ({
        assetId: item.assetId,
        status: item.status,
        selectedCandidate: item.selectedCandidate
      }))
    };

    const nextState: DesktopProjectState = {
      ...state,
      relinkHistory: [entry, ...state.relinkHistory].slice(0, 30),
      updatedAt: nowIso
    };

    await saveDesktopProjectState({
      legacyProjectId: ctx.legacyProject.id,
      existingConfig: ctx.legacyProject.config,
      nextState
    });
  }

  await trackDesktopWorkflowEvent({
    workspaceId: ctx.workspace.id,
    projectV2Id: ctx.projectV2.id,
    userId: ctx.user.id,
    event: "media_relink",
    outcome: recommended.summary.unmatched > 0 ? "INFO" : "SUCCESS",
    metadata: {
      totalMissing: recommended.summary.totalMissing,
      matched: recommended.summary.matched,
      unmatched: recommended.summary.unmatched,
      apply: params.apply === true
    }
  });

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    ...recommended,
    applied: params.apply === true
  };
}

export async function listProjectDesktopNotifications(params: {
  projectIdOrV2Id: string;
  includeAcknowledged?: boolean;
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const state = loadDesktopProjectState(ctx.legacyProject.config);

  const recentEvents = await prisma.qualityFeedback.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      category: {
        startsWith: "desktop."
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 120,
    select: {
      id: true,
      category: true,
      comment: true,
      metadata: true,
      createdAt: true
    }
  });

  const drafts = normalizeDesktopOfflineDrafts({
    drafts: state.offlineDrafts,
    currentRevisionId: ctx.projectV2.currentRevisionId
  });

  const notifications = buildDesktopNotificationQueue({
    recentEvents: recentEvents.map((event) => ({
      id: event.id,
      event: event.category,
      outcome: event.comment ?? "INFO",
      createdAt: event.createdAt.toISOString(),
      metadata: event.metadata
    })),
    relinkSummary: state.relinkHistory[0]?.summary
      ? {
          unmatched: state.relinkHistory[0].summary.unmatched
        }
      : null,
    offlineDraftSummary: {
      conflict: drafts.filter((draft) => draft.status === "CONFLICT").length
    }
  });

  const acknowledged = new Set(state.acknowledgedNotificationIds);
  const visible = params.includeAcknowledged
    ? notifications
    : notifications.filter((item) => !acknowledged.has(item.id));

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    notifications: visible,
    summary: {
      total: notifications.length,
      unread: notifications.filter((item) => !acknowledged.has(item.id)).length,
      acknowledged: notifications.filter((item) => acknowledged.has(item.id)).length
    },
    updatedAt: state.updatedAt
  };
}

export async function acknowledgeProjectDesktopNotifications(params: {
  projectIdOrV2Id: string;
  notificationIds: string[];
}) {
  const ctx = await requireProjectContext(params.projectIdOrV2Id);
  const state = loadDesktopProjectState(ctx.legacyProject.config);
  const nextAcks = Array.from(new Set([
    ...state.acknowledgedNotificationIds,
    ...params.notificationIds
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  ])).slice(-500);

  const nextState: DesktopProjectState = {
    ...state,
    acknowledgedNotificationIds: nextAcks,
    updatedAt: new Date().toISOString()
  };

  await saveDesktopProjectState({
    legacyProjectId: ctx.legacyProject.id,
    existingConfig: ctx.legacyProject.config,
    nextState
  });

  await trackDesktopWorkflowEvent({
    workspaceId: ctx.workspace.id,
    projectV2Id: ctx.projectV2.id,
    userId: ctx.user.id,
    event: "desktop_notification",
    outcome: "INFO",
    metadata: {
      acknowledgedCount: params.notificationIds.length
    }
  });

  return {
    projectId: ctx.legacyProject.id,
    projectV2Id: ctx.projectV2.id,
    acknowledgedCount: params.notificationIds.length,
    totalAcknowledged: nextAcks.length,
    updatedAt: nextState.updatedAt
  };
}
