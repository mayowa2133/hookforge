import { randomBytes } from "crypto";
import { type Prisma, type ReviewCommentStatus, type ReviewDecisionStatus, type ShareLinkScope } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { sanitizeOverlayText } from "@/lib/sanitize";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";
import { hasWorkspaceCapability, isManagerRole } from "@/lib/workspace-roles";
import {
  buildProjectShareUrl,
  buildReviewerPageUrl,
  clampInt,
  evaluateApprovalGate,
  hasShareScope,
  normalizeCommentAnchor,
  normalizeBrandPresetInput,
  normalizeBrandStudioMetadata,
  buildApprovalChainState,
  normalizeApprovalChain,
  type Phase5PublishConnector,
  type Phase5PublishVisibility,
  type Phase5ShareScope
} from "@/lib/review-phase5-tools";
import { buildTimelineState } from "@/lib/timeline-legacy";

type AccessContext = {
  projectV2: {
    id: string;
    workspaceId: string;
    legacyProjectId: string | null;
    currentRevisionId: string | null;
    title: string;
  };
  workspace: {
    id: string;
    slug: string;
    name: string;
  };
  legacyProject: {
    id: string;
    config: unknown;
    assets: Array<{ id: string; slotKey: string; kind: "VIDEO" | "IMAGE" | "AUDIO"; durationSec: number | null }>;
  } | null;
  membership: {
    role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  } | null;
  user: {
    id: string;
    email: string;
  } | null;
  shareLink: {
    id: string;
    token: string;
    scope: ShareLinkScope;
    expiresAt: Date | null;
    revokedAt: Date | null;
  } | null;
  accessSource: "AUTH" | "SHARE_LINK";
};

function extractShareToken(request?: Request, explicitShareToken?: string | null) {
  if (explicitShareToken && explicitShareToken.trim()) {
    return explicitShareToken.trim();
  }
  if (!request) {
    return null;
  }
  const headerToken = request.headers.get("x-share-token")?.trim();
  if (headerToken) {
    return headerToken;
  }
  try {
    const queryToken = new URL(request.url).searchParams.get("shareToken")?.trim();
    return queryToken || null;
  } catch {
    return null;
  }
}

function toShareScope(scope: ShareLinkScope): Phase5ShareScope {
  return scope;
}

function parseProjectConfig(configInput: unknown) {
  if (configInput && typeof configInput === "object") {
    return configInput as Record<string, unknown>;
  }
  return {} as Record<string, unknown>;
}

async function resolvePhase5Access(params: {
  projectIdOrV2Id: string;
  requiredScope: Phase5ShareScope;
  request?: Request;
  explicitShareToken?: string | null;
}) {
  const now = new Date();
  const shareToken = extractShareToken(params.request, params.explicitShareToken);
  if (shareToken) {
    const link = await prisma.shareLink.findFirst({
      where: {
        token: shareToken,
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } }
        ]
      },
      include: {
        workspace: {
          select: {
            id: true,
            slug: true,
            name: true
          }
        },
        project: {
          select: {
            id: true,
            workspaceId: true,
            legacyProjectId: true,
            currentRevisionId: true,
            title: true
          }
        }
      }
    });

    if (!link) {
      throw new Error("Unauthorized");
    }
    if (link.project.id !== params.projectIdOrV2Id && link.project.legacyProjectId !== params.projectIdOrV2Id) {
      throw new Error("Unauthorized");
    }
    if (!hasShareScope(toShareScope(link.scope), params.requiredScope)) {
      throw new Error("Unauthorized");
    }

    const legacyProject = link.project.legacyProjectId
      ? await prisma.project.findUnique({
          where: { id: link.project.legacyProjectId },
          select: {
            id: true,
            config: true,
            assets: {
              select: {
                id: true,
                slotKey: true,
                kind: true,
                durationSec: true
              }
            }
          }
        })
      : null;

    const context: AccessContext = {
      projectV2: link.project,
      workspace: link.workspace,
      legacyProject,
      membership: null,
      user: null,
      shareLink: {
        id: link.id,
        token: link.token,
        scope: link.scope,
        expiresAt: link.expiresAt,
        revokedAt: link.revokedAt
      },
      accessSource: "SHARE_LINK"
    };
    return context;
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Unauthorized");
  }

  const projectV2 = await prisma.projectV2.findFirst({
    where: {
      OR: [
        { id: params.projectIdOrV2Id },
        { legacyProjectId: params.projectIdOrV2Id }
      ],
      workspace: {
        members: {
          some: {
            userId: user.id
          }
        }
      }
    },
    select: {
      id: true,
      workspaceId: true,
      legacyProjectId: true,
      currentRevisionId: true,
      title: true,
      workspace: {
        select: {
          id: true,
          slug: true,
          name: true
        }
      }
    }
  });

  if (!projectV2) {
    throw new Error("Project not found");
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: projectV2.workspaceId,
        userId: user.id
      }
    },
    select: {
      role: true
    }
  });
  if (!membership) {
    throw new Error("Unauthorized");
  }

  if (params.requiredScope === "VIEW" && !hasWorkspaceCapability(membership.role, "workspace.projects.read")) {
    throw new Error("Unauthorized");
  }
  if ((params.requiredScope === "COMMENT" || params.requiredScope === "APPROVE") && !hasWorkspaceCapability(membership.role, "workspace.projects.write")) {
    throw new Error("Unauthorized");
  }
  if (params.requiredScope === "APPROVE" && !isManagerRole(membership.role)) {
    throw new Error("Unauthorized");
  }

  const legacyProject = projectV2.legacyProjectId
    ? await prisma.project.findUnique({
        where: { id: projectV2.legacyProjectId },
        select: {
          id: true,
          config: true,
          assets: {
            select: {
              id: true,
              slotKey: true,
              kind: true,
              durationSec: true
            }
          }
        }
      })
    : null;

  const context: AccessContext = {
    projectV2: {
      id: projectV2.id,
      workspaceId: projectV2.workspaceId,
      legacyProjectId: projectV2.legacyProjectId,
      currentRevisionId: projectV2.currentRevisionId,
      title: projectV2.title
    },
    workspace: projectV2.workspace,
    legacyProject,
    membership: {
      role: membership.role
    },
    user: {
      id: user.id,
      email: user.email
    },
    shareLink: null,
    accessSource: "AUTH"
  };
  return context;
}

function buildAuditDetails(params: {
  source: AccessContext["accessSource"];
  shareLinkId: string | null;
  shareScope: ShareLinkScope | null;
  extra?: Record<string, unknown>;
}) {
  return {
    source: params.source,
    shareLinkId: params.shareLinkId,
    shareScope: params.shareScope,
    ...(params.extra ?? {})
  };
}

function assertLegacyProject(context: AccessContext) {
  if (!context.legacyProject) {
    throw new Error("Legacy project bridge not found");
  }
  return context.legacyProject;
}

export async function listProjectShareLinks(projectIdOrV2Id: string, request?: Request) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id,
    request,
    requiredScope: "COMMENT"
  });

  const links = await prisma.shareLink.findMany({
    where: {
      projectId: access.projectV2.id
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 80
  });

  const now = new Date();
  return {
    projectId: access.projectV2.legacyProjectId ?? access.projectV2.id,
    projectV2Id: access.projectV2.id,
    shareLinks: links.map((link) => ({
      id: link.id,
      scope: link.scope,
      tokenPrefix: link.token.slice(0, 10),
      expiresAt: link.expiresAt?.toISOString() ?? null,
      revokedAt: link.revokedAt?.toISOString() ?? null,
      createdAt: link.createdAt.toISOString(),
      isActive: link.revokedAt === null && (link.expiresAt === null || link.expiresAt > now),
      shareUrl: buildProjectShareUrl(env.NEXT_PUBLIC_APP_URL, access.projectV2.id, link.token),
      reviewerPageUrl: buildReviewerPageUrl(env.NEXT_PUBLIC_APP_URL, access.projectV2.id, link.token)
    }))
  };
}

export async function createProjectShareLink(params: {
  projectIdOrV2Id: string;
  scope: ShareLinkScope;
  expiresInDays?: number;
  request?: Request;
}) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id: params.projectIdOrV2Id,
    request: params.request,
    requiredScope: "APPROVE"
  });

  const expiresInDays = params.expiresInDays === undefined
    ? null
    : clampInt(params.expiresInDays, 1, 365);
  const expiresAt = expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
  const token = randomBytes(24).toString("base64url");

  const link = await prisma.shareLink.create({
    data: {
      workspaceId: access.workspace.id,
      projectId: access.projectV2.id,
      createdByUserId: access.user?.id ?? null,
      token,
      scope: params.scope,
      expiresAt
    }
  });

  if (access.user?.id) {
    await recordWorkspaceAuditEvent({
      workspaceId: access.workspace.id,
      actorUserId: access.user.id,
      action: "review.share_link.create",
      targetType: "project",
      targetId: access.projectV2.id,
      details: buildAuditDetails({
        source: access.accessSource,
        shareLinkId: link.id,
        shareScope: link.scope,
        extra: {
          expiresAt: expiresAt?.toISOString() ?? null
        }
      })
    });
  }

  return {
    shareLink: {
      id: link.id,
      scope: link.scope,
      expiresAt: link.expiresAt?.toISOString() ?? null,
      revokedAt: link.revokedAt?.toISOString() ?? null,
      createdAt: link.createdAt.toISOString(),
      shareUrl: buildProjectShareUrl(env.NEXT_PUBLIC_APP_URL, access.projectV2.id, link.token),
      reviewerPageUrl: buildReviewerPageUrl(env.NEXT_PUBLIC_APP_URL, access.projectV2.id, link.token)
    }
  };
}

export async function listProjectReviewComments(params: {
  projectIdOrV2Id: string;
  request?: Request;
  shareToken?: string | null;
}) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id: params.projectIdOrV2Id,
    request: params.request,
    explicitShareToken: params.shareToken,
    requiredScope: "VIEW"
  });

  const config = parseProjectConfig(access.legacyProject?.config);
  const approvalRequired = config.reviewApprovalRequired === true;

  const comments = await prisma.reviewComment.findMany({
    where: {
      projectId: access.projectV2.id
    },
    include: {
      author: {
        select: {
          id: true,
          email: true
        }
      },
      resolvedBy: {
        select: {
          id: true,
          email: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    },
    take: 400
  });

  const latestDecision = await prisma.reviewDecision.findFirst({
    where: {
      projectId: access.projectV2.id
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true,
      status: true,
      revisionId: true,
      note: true,
      createdAt: true
    }
  });

  let timelineClipIds = new Set<string>();
  let timelineTrackIds = new Set<string>();
  let transcriptSegments: Array<{ startMs: number; endMs: number }> = [];
  if (access.legacyProject) {
    const timeline = buildTimelineState(access.legacyProject.config, access.legacyProject.assets as never);
    timelineTrackIds = new Set(timeline.tracks.map((track) => track.id));
    timelineClipIds = new Set(timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
    const segments = await prisma.transcriptSegment.findMany({
      where: {
        projectId: access.projectV2.id
      },
      select: {
        startMs: true,
        endMs: true
      },
      orderBy: {
        startMs: "asc"
      },
      take: 1000
    });
    transcriptSegments = segments;
  }

  return {
    projectId: access.projectV2.legacyProjectId ?? access.projectV2.id,
    projectV2Id: access.projectV2.id,
    reviewGate: {
      approvalRequired,
      latestDecision: latestDecision
        ? {
            id: latestDecision.id,
            status: latestDecision.status,
            revisionId: latestDecision.revisionId,
            note: latestDecision.note,
            createdAt: latestDecision.createdAt.toISOString()
          }
        : null
    },
    comments: comments.map((comment) => {
      const transcriptOverlapCount = (comment.transcriptStartMs !== null && comment.transcriptEndMs !== null)
        ? transcriptSegments.filter((segment) => segment.endMs >= comment.transcriptStartMs! && segment.startMs <= comment.transcriptEndMs!).length
        : 0;
      const trackExists = comment.timelineTrackId ? timelineTrackIds.has(comment.timelineTrackId) : true;
      const clipExists = comment.clipId ? timelineClipIds.has(comment.clipId) : true;
      return {
        id: comment.id,
        body: comment.body,
        status: comment.status,
        anchorMs: comment.anchorMs,
        transcriptStartMs: comment.transcriptStartMs,
        transcriptEndMs: comment.transcriptEndMs,
        timelineTrackId: comment.timelineTrackId,
        clipId: comment.clipId,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
        author: comment.author,
        resolvedBy: comment.resolvedBy,
        resolvedAt: comment.resolvedAt?.toISOString() ?? null,
        anchorIntegrity: {
          trackExists,
          clipExists,
          transcriptOverlapCount
        }
      };
    })
  };
}

export async function createProjectReviewComment(params: {
  projectIdOrV2Id: string;
  request?: Request;
  shareToken?: string | null;
  body: string;
  anchorMs?: number | null;
  transcriptStartMs?: number | null;
  transcriptEndMs?: number | null;
  timelineTrackId?: string | null;
  clipId?: string | null;
}) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id: params.projectIdOrV2Id,
    request: params.request,
    explicitShareToken: params.shareToken,
    requiredScope: "COMMENT"
  });

  const normalized = normalizeCommentAnchor({
    anchorMs: params.anchorMs,
    transcriptStartMs: params.transcriptStartMs,
    transcriptEndMs: params.transcriptEndMs
  });
  const comment = await prisma.reviewComment.create({
    data: {
      workspaceId: access.workspace.id,
      projectId: access.projectV2.id,
      authorUserId: access.user?.id ?? null,
      shareLinkId: access.shareLink?.id ?? null,
      body: sanitizeOverlayText(params.body, "review comment"),
      anchorMs: normalized.anchorMs,
      transcriptStartMs: normalized.transcriptStartMs,
      transcriptEndMs: normalized.transcriptEndMs,
      timelineTrackId: params.timelineTrackId ?? null,
      clipId: params.clipId ?? null
    },
    include: {
      author: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });

  if (access.user?.id) {
    await recordWorkspaceAuditEvent({
      workspaceId: access.workspace.id,
      actorUserId: access.user.id,
      action: "review.comment.create",
      targetType: "project",
      targetId: access.projectV2.id,
      details: buildAuditDetails({
        source: access.accessSource,
        shareLinkId: access.shareLink?.id ?? null,
        shareScope: access.shareLink?.scope ?? null,
        extra: {
          commentId: comment.id
        }
      })
    });
  }

  return {
    comment: {
      id: comment.id,
      body: comment.body,
      status: comment.status,
      anchorMs: comment.anchorMs,
      transcriptStartMs: comment.transcriptStartMs,
      transcriptEndMs: comment.transcriptEndMs,
      timelineTrackId: comment.timelineTrackId,
      clipId: comment.clipId,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      author: comment.author
    }
  };
}

export async function updateProjectReviewCommentStatus(params: {
  projectIdOrV2Id: string;
  commentId: string;
  request?: Request;
  shareToken?: string | null;
  status: ReviewCommentStatus;
}) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id: params.projectIdOrV2Id,
    request: params.request,
    explicitShareToken: params.shareToken,
    requiredScope: "COMMENT"
  });

  const existing = await prisma.reviewComment.findFirst({
    where: {
      id: params.commentId,
      projectId: access.projectV2.id
    }
  });
  if (!existing) {
    throw new Error("Comment not found");
  }

  const updated = await prisma.reviewComment.update({
    where: {
      id: existing.id
    },
    data: {
      status: params.status,
      resolvedAt: params.status === "RESOLVED" ? new Date() : null,
      resolvedByUserId: params.status === "RESOLVED" ? access.user?.id ?? null : null
    }
  });

  if (access.user?.id) {
    await recordWorkspaceAuditEvent({
      workspaceId: access.workspace.id,
      actorUserId: access.user.id,
      action: "review.comment.status",
      targetType: "comment",
      targetId: updated.id,
      details: buildAuditDetails({
        source: access.accessSource,
        shareLinkId: access.shareLink?.id ?? null,
        shareScope: access.shareLink?.scope ?? null,
        extra: {
          status: params.status
        }
      })
    });
  }

  return {
    comment: {
      id: updated.id,
      status: updated.status,
      resolvedAt: updated.resolvedAt?.toISOString() ?? null,
      resolvedByUserId: updated.resolvedByUserId
    }
  };
}

export async function submitProjectReviewDecision(params: {
  projectIdOrV2Id: string;
  request?: Request;
  shareToken?: string | null;
  status: ReviewDecisionStatus;
  note?: string;
  requireApproval?: boolean;
}) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id: params.projectIdOrV2Id,
    request: params.request,
    explicitShareToken: params.shareToken,
    requiredScope: "APPROVE"
  });
  const legacyProject = assertLegacyProject(access);
  const currentConfig = parseProjectConfig(legacyProject.config);
  const approvalRequired = params.requireApproval ?? true;

  const decision = await prisma.reviewDecision.create({
    data: {
      workspaceId: access.workspace.id,
      projectId: access.projectV2.id,
      revisionId: access.projectV2.currentRevisionId,
      decidedByUserId: access.user?.id ?? null,
      status: params.status,
      note: params.note ? sanitizeOverlayText(params.note, "review note") : null,
      metadata: {
        source: access.accessSource,
        shareLinkId: access.shareLink?.id ?? null
      } as Prisma.InputJsonValue
    }
  });

  const nextConfig = {
    ...currentConfig,
    reviewApprovalRequired: approvalRequired,
    reviewLastDecision: {
      id: decision.id,
      status: decision.status,
      revisionId: decision.revisionId,
      createdAt: decision.createdAt.toISOString()
    }
  };
  await prisma.project.update({
    where: { id: legacyProject.id },
    data: {
      config: nextConfig as never
    }
  });

  if (access.user?.id) {
    await recordWorkspaceAuditEvent({
      workspaceId: access.workspace.id,
      actorUserId: access.user.id,
      action: "review.decision.submit",
      targetType: "project",
      targetId: access.projectV2.id,
      details: buildAuditDetails({
        source: access.accessSource,
        shareLinkId: access.shareLink?.id ?? null,
        shareScope: access.shareLink?.scope ?? null,
        extra: {
          decisionId: decision.id,
          status: decision.status,
          requireApproval: approvalRequired
        }
      })
    });
  }

  return {
    decision: {
      id: decision.id,
      status: decision.status,
      revisionId: decision.revisionId,
      note: decision.note,
      createdAt: decision.createdAt.toISOString()
    },
    approvalRequired
  };
}

export async function listProjectExportProfiles(projectIdOrV2Id: string, request?: Request) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id,
    request,
    requiredScope: "COMMENT"
  });
  const profiles = await prisma.exportProfile.findMany({
    where: {
      workspaceId: access.workspace.id
    },
    orderBy: [
      { isDefault: "desc" },
      { updatedAt: "desc" }
    ],
    take: 100
  });

  return {
    workspaceId: access.workspace.id,
    projectV2Id: access.projectV2.id,
    exportProfiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      container: profile.container,
      resolution: profile.resolution,
      fps: profile.fps,
      videoBitrateKbps: profile.videoBitrateKbps,
      audioBitrateKbps: profile.audioBitrateKbps,
      audioPreset: profile.audioPreset,
      captionStylePresetId: profile.captionStylePresetId,
      isDefault: profile.isDefault,
      config: profile.config,
      updatedAt: profile.updatedAt.toISOString()
    }))
  };
}

export async function applyProjectExportProfile(params: {
  projectIdOrV2Id: string;
  request?: Request;
  profileId?: string;
  createProfile?: {
    name: string;
    container?: string;
    resolution?: string;
    fps?: number;
    videoBitrateKbps?: number | null;
    audioBitrateKbps?: number | null;
    audioPreset?: string | null;
    captionStylePresetId?: string | null;
    isDefault?: boolean;
    config?: Record<string, unknown>;
  };
}) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id: params.projectIdOrV2Id,
    request: params.request,
    requiredScope: "COMMENT"
  });
  const legacyProject = assertLegacyProject(access);

  let profile = params.profileId
    ? await prisma.exportProfile.findFirst({
        where: {
          id: params.profileId,
          workspaceId: access.workspace.id
        }
      })
    : null;

  if (!profile && params.createProfile) {
    const isDefault = Boolean(params.createProfile.isDefault);
    if (isDefault) {
      await prisma.exportProfile.updateMany({
        where: {
          workspaceId: access.workspace.id,
          isDefault: true
        },
        data: {
          isDefault: false
        }
      });
    }
    profile = await prisma.exportProfile.create({
      data: {
        workspaceId: access.workspace.id,
        createdByUserId: access.user?.id ?? null,
        name: sanitizeOverlayText(params.createProfile.name, "Export profile"),
        container: params.createProfile.container ?? "mp4",
        resolution: params.createProfile.resolution ?? "1080x1920",
        fps: clampInt(params.createProfile.fps ?? 30, 12, 120),
        videoBitrateKbps: params.createProfile.videoBitrateKbps ?? null,
        audioBitrateKbps: params.createProfile.audioBitrateKbps ?? null,
        audioPreset: params.createProfile.audioPreset ?? null,
        captionStylePresetId: params.createProfile.captionStylePresetId ?? null,
        isDefault,
        config: (params.createProfile.config ?? {}) as Prisma.InputJsonValue
      }
    });
  }

  if (!profile) {
    throw new Error("Export profile not found");
  }

  const currentConfig = parseProjectConfig(legacyProject.config);
  const nextConfig = {
    ...currentConfig,
    exportProfile: {
      id: profile.id,
      name: profile.name,
      container: profile.container,
      resolution: profile.resolution,
      fps: profile.fps,
      videoBitrateKbps: profile.videoBitrateKbps,
      audioBitrateKbps: profile.audioBitrateKbps,
      audioPreset: profile.audioPreset,
      captionStylePresetId: profile.captionStylePresetId,
      isDefault: profile.isDefault,
      appliedAt: new Date().toISOString()
    }
  };
  await prisma.project.update({
    where: { id: legacyProject.id },
    data: {
      config: nextConfig as never
    }
  });

  if (access.user?.id) {
    await recordWorkspaceAuditEvent({
      workspaceId: access.workspace.id,
      actorUserId: access.user.id,
      action: "export.profile.apply",
      targetType: "project",
      targetId: access.projectV2.id,
      details: {
        profileId: profile.id,
        profileName: profile.name
      }
    });
  }

  const profiles = await prisma.exportProfile.findMany({
    where: {
      workspaceId: access.workspace.id
    },
    orderBy: [
      { isDefault: "desc" },
      { updatedAt: "desc" }
    ],
    take: 100
  });

  return {
    applied: true,
    profile: {
      id: profile.id,
      name: profile.name,
      container: profile.container,
      resolution: profile.resolution,
      fps: profile.fps,
      videoBitrateKbps: profile.videoBitrateKbps,
      audioBitrateKbps: profile.audioBitrateKbps,
      audioPreset: profile.audioPreset,
      captionStylePresetId: profile.captionStylePresetId,
      isDefault: profile.isDefault
    },
    exportProfiles: profiles.map((entry) => ({
      id: entry.id,
      name: entry.name,
      container: entry.container,
      resolution: entry.resolution,
      fps: entry.fps,
      videoBitrateKbps: entry.videoBitrateKbps,
      audioBitrateKbps: entry.audioBitrateKbps,
      audioPreset: entry.audioPreset,
      captionStylePresetId: entry.captionStylePresetId,
      isDefault: entry.isDefault,
      updatedAt: entry.updatedAt.toISOString()
    }))
  };
}

export async function getWorkspaceBrandPreset(projectIdOrV2Id: string, request?: Request) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id,
    request,
    requiredScope: "COMMENT"
  });

  const [preset, defaultExportProfile, captionStyles] = await Promise.all([
    prisma.workspaceBrandPreset.findUnique({
      where: {
        workspaceId: access.workspace.id
      }
    }),
    prisma.exportProfile.findFirst({
      where: {
        workspaceId: access.workspace.id,
        isDefault: true
      },
      orderBy: {
        updatedAt: "desc"
      }
    }),
    prisma.captionStylePreset.findMany({
      where: {
        workspaceId: access.workspace.id
      },
      orderBy: [
        { isSystem: "desc" },
        { updatedAt: "desc" }
      ],
      take: 100
    })
  ]);

  const normalized = normalizeBrandPresetInput({
    name: preset?.name ?? null,
    captionStylePresetId: preset?.captionStylePresetId ?? defaultExportProfile?.captionStylePresetId ?? null,
    audioPreset: preset?.audioPreset ?? defaultExportProfile?.audioPreset ?? null,
    defaultConnector: preset?.defaultConnector ?? "package",
    defaultVisibility: preset?.defaultVisibility ?? "private",
    defaultTitlePrefix: preset?.defaultTitlePrefix ?? null,
    defaultTags: preset?.defaultTags ?? [],
    metadata: (preset?.metadata && typeof preset.metadata === "object")
      ? (preset.metadata as Record<string, unknown>)
      : {}
  });
  const brandStudioDetails = normalizeBrandStudioMetadata(normalized.metadata);

  return {
    workspaceId: access.workspace.id,
    projectV2Id: access.projectV2.id,
    brandPreset: {
      id: preset?.id ?? null,
      name: normalized.name,
      captionStylePresetId: normalized.captionStylePresetId,
      audioPreset: normalized.audioPreset,
      defaultConnector: normalized.defaultConnector,
      defaultVisibility: normalized.defaultVisibility,
      defaultTitlePrefix: normalized.defaultTitlePrefix,
      defaultTags: normalized.defaultTags,
      metadata: normalized.metadata,
      details: brandStudioDetails,
      createdAt: preset?.createdAt.toISOString() ?? null,
      updatedAt: preset?.updatedAt.toISOString() ?? null
    },
    exportProfileDefaults: defaultExportProfile
      ? {
          id: defaultExportProfile.id,
          name: defaultExportProfile.name,
          container: defaultExportProfile.container,
          resolution: defaultExportProfile.resolution,
          fps: defaultExportProfile.fps,
          audioPreset: defaultExportProfile.audioPreset,
          captionStylePresetId: defaultExportProfile.captionStylePresetId,
          updatedAt: defaultExportProfile.updatedAt.toISOString()
        }
      : null,
    captionStylePresets: captionStyles.map((style) => ({
      id: style.id,
      name: style.name,
      isSystem: style.isSystem
    }))
  };
}

export async function upsertWorkspaceBrandPreset(params: {
  projectIdOrV2Id: string;
  request?: Request;
  input: {
    name?: string | null;
    captionStylePresetId?: string | null;
    audioPreset?: string | null;
    defaultConnector?: string | null;
    defaultVisibility?: string | null;
    defaultTitlePrefix?: string | null;
    defaultTags?: string[] | null;
    metadata?: Record<string, unknown> | null;
  };
}) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id: params.projectIdOrV2Id,
    request: params.request,
    requiredScope: "APPROVE"
  });
  if (!access.user?.id || !access.membership || !isManagerRole(access.membership.role)) {
    throw new Error("Unauthorized");
  }

  const normalized = normalizeBrandPresetInput(params.input);
  if (normalized.captionStylePresetId) {
    const style = await prisma.captionStylePreset.findFirst({
      where: {
        id: normalized.captionStylePresetId,
        workspaceId: access.workspace.id
      },
      select: {
        id: true
      }
    });
    if (!style) {
      throw new Error("Caption style preset not found");
    }
  }

  const sanitizedName = sanitizeOverlayText(normalized.name, "brand preset name");
  const sanitizedTitlePrefix = normalized.defaultTitlePrefix
    ? sanitizeOverlayText(normalized.defaultTitlePrefix, "brand title prefix")
    : null;
  const preset = await prisma.workspaceBrandPreset.upsert({
    where: {
      workspaceId: access.workspace.id
    },
    create: {
      workspaceId: access.workspace.id,
      updatedByUserId: access.user.id,
      name: sanitizedName,
      captionStylePresetId: normalized.captionStylePresetId,
      audioPreset: normalized.audioPreset,
      defaultConnector: normalized.defaultConnector,
      defaultVisibility: normalized.defaultVisibility,
      defaultTitlePrefix: sanitizedTitlePrefix,
      defaultTags: normalized.defaultTags,
      metadata: normalized.metadata as Prisma.InputJsonValue
    },
    update: {
      updatedByUserId: access.user.id,
      name: sanitizedName,
      captionStylePresetId: normalized.captionStylePresetId,
      audioPreset: normalized.audioPreset,
      defaultConnector: normalized.defaultConnector,
      defaultVisibility: normalized.defaultVisibility,
      defaultTitlePrefix: sanitizedTitlePrefix,
      defaultTags: normalized.defaultTags,
      metadata: normalized.metadata as Prisma.InputJsonValue
    }
  });

  let linkedExportProfile = await prisma.exportProfile.findFirst({
    where: {
      workspaceId: access.workspace.id,
      isDefault: true
    },
    orderBy: {
      updatedAt: "desc"
    }
  });
  if (!linkedExportProfile) {
    linkedExportProfile = await prisma.exportProfile.create({
      data: {
        workspaceId: access.workspace.id,
        createdByUserId: access.user.id,
        name: `${sanitizedName} Default Export`,
        isDefault: true,
        audioPreset: normalized.audioPreset,
        captionStylePresetId: normalized.captionStylePresetId,
        config: {
          brandPresetId: preset.id,
          defaultConnector: normalized.defaultConnector,
          defaultVisibility: normalized.defaultVisibility,
          defaultTitlePrefix: sanitizedTitlePrefix,
          defaultTags: normalized.defaultTags
        } as Prisma.InputJsonValue
      }
    });
  } else {
    const existingConfig = (linkedExportProfile.config && typeof linkedExportProfile.config === "object")
      ? (linkedExportProfile.config as Record<string, unknown>)
      : {};
    linkedExportProfile = await prisma.exportProfile.update({
      where: {
        id: linkedExportProfile.id
      },
      data: {
        audioPreset: normalized.audioPreset,
        captionStylePresetId: normalized.captionStylePresetId,
        config: {
          ...existingConfig,
          brandPresetId: preset.id,
          defaultConnector: normalized.defaultConnector,
          defaultVisibility: normalized.defaultVisibility,
          defaultTitlePrefix: sanitizedTitlePrefix,
          defaultTags: normalized.defaultTags
        } as Prisma.InputJsonValue
      }
    });
  }

  await recordWorkspaceAuditEvent({
    workspaceId: access.workspace.id,
    actorUserId: access.user.id,
    action: "workspace.brand_preset.upsert",
    targetType: "workspace",
    targetId: access.workspace.id,
    details: {
      brandPresetId: preset.id,
      defaultConnector: preset.defaultConnector,
      defaultVisibility: preset.defaultVisibility,
      linkedExportProfileId: linkedExportProfile.id
    }
  });

  const brandStudioDetails = normalizeBrandStudioMetadata(preset.metadata);

  return {
    workspaceId: access.workspace.id,
    projectV2Id: access.projectV2.id,
    brandPreset: {
      id: preset.id,
      name: preset.name,
      captionStylePresetId: preset.captionStylePresetId,
      audioPreset: preset.audioPreset,
      defaultConnector: preset.defaultConnector as Phase5PublishConnector,
      defaultVisibility: preset.defaultVisibility as Phase5PublishVisibility,
      defaultTitlePrefix: preset.defaultTitlePrefix,
      defaultTags: preset.defaultTags,
      metadata: preset.metadata,
      details: brandStudioDetails,
      createdAt: preset.createdAt.toISOString(),
      updatedAt: preset.updatedAt.toISOString()
    },
    linkedExportProfile: {
      id: linkedExportProfile.id,
      name: linkedExportProfile.name,
      isDefault: linkedExportProfile.isDefault,
      audioPreset: linkedExportProfile.audioPreset,
      captionStylePresetId: linkedExportProfile.captionStylePresetId,
      updatedAt: linkedExportProfile.updatedAt.toISOString()
    }
  };
}

function summarizeRevisionOperations(operationsInput: unknown) {
  const operations = Array.isArray(operationsInput) ? operationsInput : [];
  const byType: Record<string, number> = {};
  const sample: Array<{ op: string; keys: string[] }> = [];
  for (const operation of operations) {
    const record = parseProjectConfig(operation);
    const op = typeof record.op === "string"
      ? record.op
      : (typeof record.type === "string" ? record.type : "unknown");
    byType[op] = (byType[op] ?? 0) + 1;
    if (sample.length < 12) {
      sample.push({
        op,
        keys: Object.keys(record).slice(0, 8)
      });
    }
  }
  return {
    total: operations.length,
    byType,
    sample
  };
}

export async function getProjectReviewVersionCompare(params: {
  projectIdOrV2Id: string;
  request?: Request;
  shareToken?: string | null;
  baseRevisionId?: string | null;
  targetRevisionId?: string | null;
}) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id: params.projectIdOrV2Id,
    request: params.request,
    explicitShareToken: params.shareToken,
    requiredScope: "VIEW"
  });

  const targetRevisionId = params.targetRevisionId ?? access.projectV2.currentRevisionId;
  if (!targetRevisionId) {
    throw new Error("No revision available for compare");
  }

  const targetRevision = await prisma.timelineRevision.findFirst({
    where: {
      id: targetRevisionId,
      projectId: access.projectV2.id
    },
    select: {
      id: true,
      revisionNumber: true,
      timelineHash: true,
      operations: true,
      createdAt: true,
      createdBy: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });
  if (!targetRevision) {
    throw new Error("Target revision not found");
  }

  const baseRevision = params.baseRevisionId
    ? await prisma.timelineRevision.findFirst({
        where: {
          id: params.baseRevisionId,
          projectId: access.projectV2.id
        },
        select: {
          id: true,
          revisionNumber: true,
          timelineHash: true,
          operations: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              email: true
            }
          }
        }
      })
    : await prisma.timelineRevision.findFirst({
        where: {
          projectId: access.projectV2.id,
          revisionNumber: {
            lt: targetRevision.revisionNumber
          }
        },
        orderBy: {
          revisionNumber: "desc"
        },
        select: {
          id: true,
          revisionNumber: true,
          timelineHash: true,
          operations: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              email: true
            }
          }
        }
      });

  const targetSummary = summarizeRevisionOperations(targetRevision.operations);
  const baseSummary = baseRevision ? summarizeRevisionOperations(baseRevision.operations) : null;
  const typeKeys = new Set<string>([
    ...Object.keys(targetSummary.byType),
    ...(baseSummary ? Object.keys(baseSummary.byType) : [])
  ]);
  const deltaByType = Array.from(typeKeys).sort().reduce<Record<string, number>>((acc, key) => {
    acc[key] = (targetSummary.byType[key] ?? 0) - (baseSummary?.byType[key] ?? 0);
    return acc;
  }, {});

  return {
    projectId: access.projectV2.legacyProjectId ?? access.projectV2.id,
    projectV2Id: access.projectV2.id,
    comparable: Boolean(baseRevision),
    baseRevision: baseRevision
      ? {
          id: baseRevision.id,
          revisionNumber: baseRevision.revisionNumber,
          timelineHash: baseRevision.timelineHash,
          createdAt: baseRevision.createdAt.toISOString(),
          createdBy: baseRevision.createdBy
        }
      : null,
    targetRevision: {
      id: targetRevision.id,
      revisionNumber: targetRevision.revisionNumber,
      timelineHash: targetRevision.timelineHash,
      createdAt: targetRevision.createdAt.toISOString(),
      createdBy: targetRevision.createdBy
    },
    summary: {
      base: baseSummary,
      target: targetSummary,
      changedOperationCount: baseSummary ? Math.abs(targetSummary.total - baseSummary.total) : targetSummary.total,
      deltaByType
    }
  };
}

export async function listProjectReviewAuditTrail(params: {
  projectIdOrV2Id: string;
  request?: Request;
  limit?: number;
}) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id: params.projectIdOrV2Id,
    request: params.request,
    requiredScope: "COMMENT"
  });
  if (!access.user?.id) {
    throw new Error("Unauthorized");
  }

  const limit = clampInt(params.limit ?? 100, 1, 200);
  const [publishJobs, reviewRequests, comments] = await Promise.all([
    prisma.publishConnectorJob.findMany({
      where: {
        workspaceId: access.workspace.id,
        projectId: access.projectV2.id
      },
      select: {
        id: true
      },
      take: 300
    }),
    prisma.reviewRequest.findMany({
      where: {
        workspaceId: access.workspace.id,
        projectId: access.projectV2.id
      },
      select: {
        id: true
      },
      take: 300
    }),
    prisma.reviewComment.findMany({
      where: {
        workspaceId: access.workspace.id,
        projectId: access.projectV2.id
      },
      select: {
        id: true
      },
      take: 500
    })
  ]);

  const projectScopedTargetIds = new Set<string>([
    access.projectV2.id,
    ...publishJobs.map((job) => job.id),
    ...reviewRequests.map((request) => request.id),
    ...comments.map((comment) => comment.id)
  ]);

  const events = await prisma.auditEvent.findMany({
    where: {
      workspaceId: access.workspace.id,
      OR: [
        { action: { startsWith: "review." } },
        { action: { startsWith: "publish." } },
        { action: { startsWith: "brand_studio." } },
        { action: "workspace.brand_preset.upsert" }
      ]
    },
    orderBy: {
      createdAt: "desc"
    },
    take: Math.min(limit * 8, 1000)
  });

  const filtered = events
    .filter((event) => {
      if (event.targetId && projectScopedTargetIds.has(event.targetId)) {
        return true;
      }
      const metadata = parseProjectConfig(event.metadata);
      return metadata.projectId === access.projectV2.id
        || metadata.projectV2Id === access.projectV2.id;
    })
    .slice(0, limit);

  return {
    workspaceId: access.workspace.id,
    projectId: access.projectV2.legacyProjectId ?? access.projectV2.id,
    projectV2Id: access.projectV2.id,
    events: filtered.map((event) => ({
      id: event.id,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      actorUserId: event.actorUserId,
      severity: event.severity,
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString()
    }))
  };
}

export async function getProjectReviewerPage(params: {
  projectIdOrV2Id: string;
  request?: Request;
  shareToken?: string | null;
}) {
  const access = await resolvePhase5Access({
    projectIdOrV2Id: params.projectIdOrV2Id,
    request: params.request,
    explicitShareToken: params.shareToken,
    requiredScope: "VIEW"
  });
  const legacyProject = assertLegacyProject(access);
  const config = parseProjectConfig(legacyProject.config);

  const [comments, latestDecision, requests, logs, publishJobs, links] = await Promise.all([
    prisma.reviewComment.findMany({
      where: {
        projectId: access.projectV2.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 200
    }),
    prisma.reviewDecision.findFirst({
      where: {
        projectId: access.projectV2.id
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        status: true,
        revisionId: true,
        note: true,
        decidedByUserId: true,
        createdAt: true
      }
    }),
    prisma.reviewRequest.findMany({
      where: {
        workspaceId: access.workspace.id,
        projectId: access.projectV2.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 30
    }),
    prisma.reviewDecisionLog.findMany({
      where: {
        workspaceId: access.workspace.id,
        projectId: access.projectV2.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 120
    }),
    prisma.publishConnectorJob.findMany({
      where: {
        workspaceId: access.workspace.id,
        projectId: access.projectV2.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 40
    }),
    prisma.shareLink.findMany({
      where: {
        projectId: access.projectV2.id
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 20
    })
  ]);

  const now = new Date();
  const commentSummary = {
    total: comments.length,
    open: comments.filter((comment) => comment.status === "OPEN").length,
    resolved: comments.filter((comment) => comment.status === "RESOLVED").length
  };
  const publishSummary = {
    total: publishJobs.length,
    done: publishJobs.filter((job) => job.status === "DONE").length,
    error: publishJobs.filter((job) => job.status === "ERROR").length,
    running: publishJobs.filter((job) => job.status === "RUNNING" || job.status === "QUEUED").length
  };

  const requestRows = requests.map((request) => {
    const requestLogs = logs.filter((log) => log.requestId === request.id).slice(0, 20);
    const chain = normalizeApprovalChain(parseProjectConfig(request.metadata).approvalChain);
    return {
      id: request.id,
      title: request.title,
      status: request.status,
      requiredScopes: request.requiredScopes,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      approvalChain: chain,
      approvalChainState: buildApprovalChainState({
        chain,
        decisions: requestLogs.map((entry) => ({
          status: entry.status,
          metadata: entry.metadata,
          decidedByUserId: entry.decidedByUserId,
          createdAt: entry.createdAt.toISOString()
        }))
      })
    };
  });

  return {
    workspaceId: access.workspace.id,
    projectId: access.projectV2.legacyProjectId ?? access.projectV2.id,
    projectV2Id: access.projectV2.id,
    reviewerPage: {
      projectTitle: access.projectV2.title,
      currentRevisionId: access.projectV2.currentRevisionId,
      approvalRequired: config.reviewApprovalRequired === true,
      accessSource: access.accessSource,
      shareLink: access.shareLink
        ? {
            id: access.shareLink.id,
            scope: access.shareLink.scope,
            expiresAt: access.shareLink.expiresAt?.toISOString() ?? null,
            reviewerPageUrl: buildReviewerPageUrl(env.NEXT_PUBLIC_APP_URL, access.projectV2.id, access.shareLink.token)
          }
        : null
    },
    summary: {
      comments: commentSummary,
      publish: publishSummary,
      latestDecision: latestDecision
        ? {
            id: latestDecision.id,
            status: latestDecision.status,
            revisionId: latestDecision.revisionId,
            note: latestDecision.note,
            decidedByUserId: latestDecision.decidedByUserId,
            createdAt: latestDecision.createdAt.toISOString()
          }
        : null
    },
    reviewRequests: requestRows,
    shareLinks: links.map((link) => ({
      id: link.id,
      scope: link.scope,
      createdAt: link.createdAt.toISOString(),
      isActive: link.revokedAt === null && (link.expiresAt === null || link.expiresAt > now),
      reviewerPageUrl: buildReviewerPageUrl(env.NEXT_PUBLIC_APP_URL, access.projectV2.id, link.token)
    })),
    recentComments: comments.slice(0, 20).map((comment) => ({
      id: comment.id,
      status: comment.status,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      resolvedAt: comment.resolvedAt?.toISOString() ?? null
    })),
    recentPublishJobs: publishJobs.slice(0, 20).map((job) => ({
      id: job.id,
      connector: job.connector,
      status: job.status,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString()
    }))
  };
}

export async function assertRenderApprovalGate(projectV2Id: string) {
  const project = await prisma.projectV2.findUnique({
    where: {
      id: projectV2Id
    },
    select: {
      id: true,
      currentRevisionId: true,
      legacyProjectId: true
    }
  });
  if (!project) {
    throw new Error("Project not found");
  }

  const legacyProject = project.legacyProjectId
    ? await prisma.project.findUnique({
        where: {
          id: project.legacyProjectId
        },
        select: {
          config: true
        }
      })
    : null;

  const config = parseProjectConfig(legacyProject?.config);
  const approvalRequired = config.reviewApprovalRequired === true;
  const latestDecision = await prisma.reviewDecision.findFirst({
    where: {
      projectId: project.id
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true,
      status: true,
      revisionId: true
    }
  });

  const gate = evaluateApprovalGate({
    approvalRequired,
    currentRevisionId: project.currentRevisionId,
    latestDecision: latestDecision
      ? {
          status: latestDecision.status,
          revisionId: latestDecision.revisionId
        }
      : null
  });
  if (!gate.allowed) {
    throw new Error(gate.reason ?? "Render approval required.");
  }

  return {
    approvalRequired,
    latestDecisionId: latestDecision?.id ?? null,
    currentRevisionId: project.currentRevisionId
  };
}
