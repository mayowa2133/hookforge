import { randomUUID } from "crypto";
import { SignJWT } from "jose";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { sanitizeOverlayText } from "@/lib/sanitize";
import { appendTimelineRevision } from "@/lib/project-v2";
import { applyTimelineOperations, buildTimelineState, serializeTimelineState } from "@/lib/timeline-legacy";
import type { TimelineOperation } from "@/lib/timeline-types";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const StudioRoomTemplateSchema = z.enum(["podcast", "interview", "panel"]);
export type StudioRoomTemplate = z.infer<typeof StudioRoomTemplateSchema>;
export const StudioRoleSchema = z.enum(["HOST", "PRODUCER", "GUEST", "VIEWER"]);
export type StudioRole = z.infer<typeof StudioRoleSchema>;
type StudioStorageRole = "HOST" | "GUEST";

type StudioRolePolicy = {
  role: StudioRole;
  canManageParticipants: boolean;
  canControlRoom: boolean;
  canPublishTracks: boolean;
  canPushToTalkBypass: boolean;
  canViewDiagnostics: boolean;
};

type StudioRoomTemplateConfig = {
  id: StudioRoomTemplate;
  title: string;
  description: string;
  defaultRoles: StudioRole[];
  captureProfile: {
    videoLayout: "single" | "split" | "grid";
    defaultResolution: "1080p" | "720p";
    echoCancellation: boolean;
    noiseSuppression: "high" | "standard";
    autoGainControl: boolean;
    localBackup: boolean;
  };
  recordingSafety: {
    requireHostPresent: boolean;
    requireProducerOrHostForStart: boolean;
    minParticipantCount: number;
    enforcePushToTalk: boolean;
  };
};

type StudioSafetyCheck = {
  code: string;
  status: "PASS" | "WARN" | "FAIL";
  message: string;
};

type StudioSafetySummary = {
  checks: StudioSafetyCheck[];
  canStartRecording: boolean;
};

type StudioParticipantRecord = {
  id: string;
  role: StudioStorageRole;
  displayName: string;
  userId: string | null;
  leftAt: Date | null;
  trackMetadata: unknown;
};

type StudioRoleCounts = Record<StudioRole, number>;

const studioRolePolicies: Record<StudioRole, StudioRolePolicy> = {
  HOST: {
    role: "HOST",
    canManageParticipants: true,
    canControlRoom: true,
    canPublishTracks: true,
    canPushToTalkBypass: true,
    canViewDiagnostics: true
  },
  PRODUCER: {
    role: "PRODUCER",
    canManageParticipants: true,
    canControlRoom: true,
    canPublishTracks: true,
    canPushToTalkBypass: true,
    canViewDiagnostics: true
  },
  GUEST: {
    role: "GUEST",
    canManageParticipants: false,
    canControlRoom: false,
    canPublishTracks: true,
    canPushToTalkBypass: false,
    canViewDiagnostics: false
  },
  VIEWER: {
    role: "VIEWER",
    canManageParticipants: false,
    canControlRoom: false,
    canPublishTracks: false,
    canPushToTalkBypass: false,
    canViewDiagnostics: false
  }
};

const studioTemplateCatalog: Record<StudioRoomTemplate, StudioRoomTemplateConfig> = {
  podcast: {
    id: "podcast",
    title: "Podcast",
    description: "Balanced two-speaker capture with resilient local backup.",
    defaultRoles: ["HOST", "PRODUCER", "GUEST"],
    captureProfile: {
      videoLayout: "split",
      defaultResolution: "1080p",
      echoCancellation: true,
      noiseSuppression: "high",
      autoGainControl: true,
      localBackup: true
    },
    recordingSafety: {
      requireHostPresent: true,
      requireProducerOrHostForStart: true,
      minParticipantCount: 2,
      enforcePushToTalk: false
    }
  },
  interview: {
    id: "interview",
    title: "Interview",
    description: "Host + guest defaults with strict control-room checks.",
    defaultRoles: ["HOST", "GUEST", "VIEWER"],
    captureProfile: {
      videoLayout: "split",
      defaultResolution: "1080p",
      echoCancellation: true,
      noiseSuppression: "high",
      autoGainControl: true,
      localBackup: true
    },
    recordingSafety: {
      requireHostPresent: true,
      requireProducerOrHostForStart: true,
      minParticipantCount: 2,
      enforcePushToTalk: false
    }
  },
  panel: {
    id: "panel",
    title: "Panel",
    description: "Multi-guest layout with push-to-talk safeguards.",
    defaultRoles: ["HOST", "PRODUCER", "GUEST", "VIEWER"],
    captureProfile: {
      videoLayout: "grid",
      defaultResolution: "720p",
      echoCancellation: true,
      noiseSuppression: "standard",
      autoGainControl: true,
      localBackup: true
    },
    recordingSafety: {
      requireHostPresent: true,
      requireProducerOrHostForStart: true,
      minParticipantCount: 3,
      enforcePushToTalk: true
    }
  }
};

export const StudioRoomCreateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  template: StudioRoomTemplateSchema.default("podcast"),
  region: z.string().trim().min(2).max(24).optional(),
  metadata: z.record(z.unknown()).optional()
});

export const StudioJoinTokenSchema = z.object({
  participantName: z.string().trim().min(1).max(80),
  role: StudioRoleSchema.default("GUEST"),
  pushToTalk: z.boolean().optional(),
  ttlSec: z.number().int().min(60).max(60 * 60 * 6).default(60 * 60)
});

export const StudioControlRoomActionSchema = z.object({
  roomId: z.string().min(1),
  action: z.enum([
    "participant_mute",
    "participant_unmute",
    "participant_remove",
    "push_to_talk_enable",
    "push_to_talk_disable",
    "run_safety_checks",
    "mark_issue",
    "resolve_issue"
  ]),
  participantId: z.string().min(1).optional(),
  issueId: z.string().min(1).optional(),
  note: z.string().trim().max(240).optional()
});

type StudioControlRoomActionInput = z.infer<typeof StudioControlRoomActionSchema>;

type StudioRoomListItem = {
  id: string;
  projectId: string;
  provider: string;
  roomName: string;
  status: "ACTIVE" | "CLOSED";
  metadata: unknown;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  participantCount: number;
  artifactCount: number;
  roleCounts: StudioRoleCounts;
};

type RoomRecord = Awaited<ReturnType<typeof prisma.studioRoom.findFirst>>;

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function buildStudioRolePolicy(role: StudioRole): StudioRolePolicy {
  return studioRolePolicies[role];
}

function resolveStudioStorageRole(role: StudioRole): StudioStorageRole {
  return role === "HOST" ? "HOST" : "GUEST";
}

function normalizeStudioRole(value: unknown): StudioRole {
  const normalized = asString(value).toUpperCase();
  if (StudioRoleSchema.safeParse(normalized).success) {
    return normalized as StudioRole;
  }
  return "GUEST";
}

function resolvedParticipantRole(participant: Pick<StudioParticipantRecord, "role" | "trackMetadata">): StudioRole {
  const metadata = asRecord(participant.trackMetadata);
  const tracked = metadata.role;
  if (StudioRoleSchema.safeParse(tracked).success) {
    return tracked as StudioRole;
  }
  return participant.role === "HOST" ? "HOST" : "GUEST";
}

function emptyRoleCounts(): StudioRoleCounts {
  return {
    HOST: 0,
    PRODUCER: 0,
    GUEST: 0,
    VIEWER: 0
  };
}

function countRoles(participants: StudioParticipantRecord[]) {
  const counts = emptyRoleCounts();
  for (const participant of participants) {
    const role = resolvedParticipantRole(participant);
    counts[role] += 1;
  }
  return counts;
}

export function buildStudioRoomTemplateConfig(inputTemplate?: string) {
  const normalized = StudioRoomTemplateSchema.safeParse(inputTemplate?.toLowerCase() ?? "podcast");
  const template = normalized.success ? normalized.data : "podcast";
  return studioTemplateCatalog[template];
}

export function listStudioRoomTemplates() {
  return Object.values(studioTemplateCatalog);
}

function roomControlMetadata(rawRoomMetadata: unknown) {
  const metadata = asRecord(rawRoomMetadata);
  const controlRoom = asRecord(metadata.controlRoom);
  const issues = Array.isArray(controlRoom.issues)
    ? controlRoom.issues
      .map((entry) => asRecord(entry))
      .filter((entry) => asString(entry.id).length > 0)
      .map((entry) => ({
        id: asString(entry.id),
        note: asString(entry.note, ""),
        status: asString(entry.status, "OPEN"),
        createdAt: asString(entry.createdAt, new Date().toISOString())
      }))
    : [];
  const actionHistory = Array.isArray(controlRoom.actionHistory)
    ? controlRoom.actionHistory
      .map((entry) => asRecord(entry))
      .filter((entry) => asString(entry.action).length > 0)
      .slice(-50)
    : [];

  return {
    metadata,
    controlRoom,
    pushToTalkEnabled: asBoolean(controlRoom.pushToTalkEnabled, false),
    issues,
    actionHistory
  };
}

export function evaluateStudioRoomSafetyChecks(params: {
  template: StudioRoomTemplate;
  roomStatus: "ACTIVE" | "CLOSED";
  participantRoleCounts: StudioRoleCounts;
  pushToTalkEnabled: boolean;
}) {
  const templateConfig = buildStudioRoomTemplateConfig(params.template);
  const checks: StudioSafetyCheck[] = [];

  const totalParticipants =
    params.participantRoleCounts.HOST +
    params.participantRoleCounts.PRODUCER +
    params.participantRoleCounts.GUEST +
    params.participantRoleCounts.VIEWER;

  if (templateConfig.recordingSafety.requireHostPresent) {
    checks.push({
      code: "HOST_PRESENT",
      status: params.participantRoleCounts.HOST > 0 ? "PASS" : "FAIL",
      message: params.participantRoleCounts.HOST > 0
        ? "Host participant is present."
        : "No host present. Recording start is blocked."
    });
  }

  if (templateConfig.recordingSafety.requireProducerOrHostForStart) {
    const controlCount = params.participantRoleCounts.HOST + params.participantRoleCounts.PRODUCER;
    checks.push({
      code: "CONTROL_ROOM_OPERATOR",
      status: controlCount > 0 ? "PASS" : "FAIL",
      message: controlCount > 0
        ? "Control-room operator is present."
        : "No host/producer available to run control-room checks."
    });
  }

  checks.push({
    code: "MIN_PARTICIPANTS",
    status: totalParticipants >= templateConfig.recordingSafety.minParticipantCount ? "PASS" : "WARN",
    message:
      totalParticipants >= templateConfig.recordingSafety.minParticipantCount
        ? `Participant count (${totalParticipants}) meets template minimum.`
        : `Template expects at least ${templateConfig.recordingSafety.minParticipantCount} participants; current count is ${totalParticipants}.`
  });

  if (templateConfig.recordingSafety.enforcePushToTalk) {
    checks.push({
      code: "PUSH_TO_TALK",
      status: params.pushToTalkEnabled ? "PASS" : "WARN",
      message: params.pushToTalkEnabled
        ? "Push-to-talk guardrail is enabled."
        : "Template recommends push-to-talk guardrail."
    });
  }

  checks.push({
    code: "ROOM_ACTIVE",
    status: params.roomStatus === "ACTIVE" ? "PASS" : "WARN",
    message: params.roomStatus === "ACTIVE"
      ? "Room is active for live control."
      : "Room is closed; control-room actions are limited."
  });

  return {
    checks,
    canStartRecording: checks.every((check) => check.status !== "FAIL")
  } as StudioSafetySummary;
}

function deterministicHealthScore(params: {
  participantRoleCounts: StudioRoleCounts;
  safety: StudioSafetySummary;
  artifactCount: number;
  activeIssueCount: number;
}) {
  const totalParticipants =
    params.participantRoleCounts.HOST +
    params.participantRoleCounts.PRODUCER +
    params.participantRoleCounts.GUEST +
    params.participantRoleCounts.VIEWER;
  let score = 62;
  score += Math.min(18, totalParticipants * 4);
  score += params.participantRoleCounts.PRODUCER > 0 ? 8 : 0;
  score += params.safety.canStartRecording ? 8 : -12;
  score += params.artifactCount > 0 ? 6 : 0;
  score -= Math.min(20, params.activeIssueCount * 7);
  return Math.max(5, Math.min(99, score));
}

function buildRoleDiagnostics(counts: StudioRoleCounts) {
  const diagnostics: string[] = [];
  if (counts.HOST === 0) {
    diagnostics.push("No host connected.");
  }
  if (counts.PRODUCER === 0) {
    diagnostics.push("No producer connected; advanced control-room actions are limited.");
  }
  if (counts.GUEST === 0) {
    diagnostics.push("No guest connected.");
  }
  if (counts.VIEWER > 0 && counts.PRODUCER === 0) {
    diagnostics.push("Viewers are present without a producer moderator.");
  }
  return diagnostics;
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "studio-room";
}

function buildRoomName(projectId: string, preferredName?: string) {
  const base = slugify(preferredName ?? "studio");
  return `${base}-${projectId.slice(-6)}-${randomUUID().slice(0, 8)}`;
}

function computeDeterministicDurationMs(startedAt?: Date | null, endedAt?: Date | null) {
  if (startedAt && endedAt) {
    const ms = endedAt.getTime() - startedAt.getTime();
    if (Number.isFinite(ms) && ms > 0) {
      return Math.max(1000, Math.min(ms, 1000 * 60 * 60));
    }
  }
  return 30_000;
}

export function buildDeterministicStudioMergePlan(params: {
  durationMs: number;
  participants: Array<{ id: string; displayName: string; role: StudioRole }>;
}) {
  const safeDuration = Math.max(1000, Math.min(60 * 60 * 1000, Math.floor(params.durationMs)));
  const segmentWindowMs = 1600;
  const participants = params.participants.length > 0
    ? [...params.participants].sort((a, b) => a.id.localeCompare(b.id))
    : [{ id: "fallback-host", displayName: "Host", role: "HOST" as const }];
  const hostFirst = [
    ...participants.filter((participant) => participant.role === "HOST"),
    ...participants.filter((participant) => participant.role === "PRODUCER"),
    ...participants.filter((participant) => participant.role === "GUEST"),
    ...participants.filter((participant) => participant.role === "VIEWER")
  ];
  const speakingCandidates = hostFirst.filter((participant) => participant.role !== "VIEWER");
  const candidatePool = speakingCandidates.length > 0 ? speakingCandidates : hostFirst;

  const segments: Array<{
    segmentId: string;
    startMs: number;
    endMs: number;
    participantId: string;
    strategy: "host_priority_round_robin";
  }> = [];
  for (let start = 0, index = 0; start < safeDuration; start += segmentWindowMs, index += 1) {
    const end = Math.min(safeDuration, start + segmentWindowMs);
    const candidate = candidatePool[index % candidatePool.length];
    segments.push({
      segmentId: `segment-${index + 1}`,
      startMs: start,
      endMs: end,
      participantId: candidate.id,
      strategy: "host_priority_round_robin"
    });
  }

  const participantCoverage = candidatePool.map((participant) => {
    const coveredMs = segments
      .filter((segment) => segment.participantId === participant.id)
      .reduce((sum, segment) => sum + (segment.endMs - segment.startMs), 0);
    return {
      participantId: participant.id,
      role: participant.role,
      displayName: participant.displayName,
      coverageMs: coveredMs,
      coveragePct: Number(((coveredMs / safeDuration) * 100).toFixed(2))
    };
  });

  return {
    durationMs: safeDuration,
    segmentWindowMs,
    segmentCount: segments.length,
    segments,
    participantCoverage,
    deterministicMergeId: `studio-merge-${safeDuration}-${candidatePool.length}`,
    conflictRepairHints: [
      "If a participant track is missing, remap its segments to host/producer in sequence.",
      "If overlap artifacts are detected, re-render only affected segments and preserve global timing."
    ]
  };
}

function buildStudioTrackOps(params: {
  roomName: string;
  participants: Array<{ id: string; displayName: string }>;
  durationMs: number;
  existingVideoTrackId: string | null;
  existingTracks: Array<{ id: string; kind: "VIDEO" | "AUDIO" | "CAPTION"; name: string; order: number }>;
}) {
  const trackName = "Studio Remote Captures";
  const existingStudioTrack = params.existingTracks.find((track) => track.kind === "VIDEO" && track.name === trackName);
  const targetTrackId = existingStudioTrack?.id ?? `studio-track-${randomUUID().slice(0, 8)}`;

  const timelineInMs = 0;
  const ops: TimelineOperation[] = [];
  if (!existingStudioTrack) {
    ops.push({
      op: "create_track",
      trackId: targetTrackId,
      kind: "VIDEO",
      name: trackName,
      uiIntent: "system_sync"
    });
  }

  const mergedLabel = `Studio Mix • ${params.roomName}`;
  ops.push({
    op: "add_clip",
    trackId: targetTrackId,
    clipId: `studio-merged-${randomUUID().slice(0, 8)}`,
    label: mergedLabel.slice(0, 160),
    slotKey: "studio_merged_reference",
    timelineInMs,
    durationMs: params.durationMs,
    sourceInMs: 0,
    sourceOutMs: params.durationMs,
    uiIntent: "system_sync"
  });

  params.participants.forEach((participant, index) => {
    ops.push({
      op: "add_clip",
      trackId: targetTrackId,
      clipId: `studio-split-${index + 1}-${randomUUID().slice(0, 8)}`,
      label: `Studio Split • ${participant.displayName}`.slice(0, 160),
      slotKey: "studio_split_track",
      timelineInMs,
      durationMs: params.durationMs,
      sourceInMs: 0,
      sourceOutMs: params.durationMs,
      uiIntent: "system_sync"
    });
  });

  return { ops };
}

async function requireStudioRoom(projectIdOrV2Id: string, roomId: string) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const room = await prisma.studioRoom.findFirst({
    where: {
      id: roomId,
      projectId: ctx.projectV2.id,
      workspaceId: ctx.workspace.id
    }
  });
  if (!room) {
    throw new Error("Studio room not found");
  }
  return { ctx, room };
}

export async function listStudioRooms(projectIdOrV2Id: string) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const rooms = await prisma.studioRoom.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 100
  });

  if (rooms.length === 0) {
    return {
      projectId: ctx.projectV2.id,
      rooms: [] as StudioRoomListItem[]
    };
  }

  const roomIds = rooms.map((room) => room.id);
  const [participants, artifacts] = await Promise.all([
    prisma.studioParticipant.findMany({
      where: {
        roomId: {
          in: roomIds
        }
      },
      select: {
        id: true,
        roomId: true,
        role: true,
        displayName: true,
        userId: true,
        leftAt: true,
        trackMetadata: true
      }
    }),
    prisma.remoteTrackArtifact.groupBy({
      by: ["roomId"],
      where: {
        roomId: {
          in: roomIds
        }
      },
      _count: {
        _all: true
      }
    })
  ]);

  const participantCountByRoom = new Map<string, number>();
  const roleCountByRoom = new Map<string, StudioRoleCounts>();
  for (const participant of participants) {
    participantCountByRoom.set(participant.roomId, (participantCountByRoom.get(participant.roomId) ?? 0) + 1);
    const roomCounts = roleCountByRoom.get(participant.roomId) ?? emptyRoleCounts();
    const resolvedRole = resolvedParticipantRole({
      role: participant.role,
      trackMetadata: participant.trackMetadata
    });
    roomCounts[resolvedRole] += 1;
    roleCountByRoom.set(participant.roomId, roomCounts);
  }
  const artifactCountByRoom = new Map(artifacts.map((row) => [row.roomId, row._count._all]));

  return {
    projectId: ctx.projectV2.id,
    rooms: rooms.map((room) => ({
      id: room.id,
      projectId: room.projectId,
      provider: room.provider,
      roomName: room.roomName,
      status: room.status,
      metadata: room.metadata,
      startedAt: room.startedAt?.toISOString() ?? null,
      endedAt: room.endedAt?.toISOString() ?? null,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString(),
      participantCount: participantCountByRoom.get(room.id) ?? 0,
      artifactCount: artifactCountByRoom.get(room.id) ?? 0,
      roleCounts: roleCountByRoom.get(room.id) ?? emptyRoleCounts()
    }))
  };
}

async function signLivekitToken(params: {
  room: RoomRecord;
  participantIdentity: string;
  participantName: string;
  role: StudioRole;
  pushToTalk: boolean;
  ttlSec: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + params.ttlSec;
  const capabilities = buildStudioRolePolicy(params.role);
  if (env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
    const token = await new SignJWT({
      video: {
        roomJoin: true,
        room: params.room?.roomName,
        canPublish: capabilities.canPublishTracks,
        canSubscribe: true,
        canPublishData: capabilities.canControlRoom
      },
      metadata: JSON.stringify({
        role: params.role,
        pushToTalk: params.pushToTalk
      }),
      name: params.participantName
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(env.LIVEKIT_API_KEY)
      .setSubject(params.participantIdentity)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(new TextEncoder().encode(env.LIVEKIT_API_SECRET));
    return {
      token,
      provider: "LIVEKIT_MANAGED"
    };
  }

  const fallbackPayload = Buffer.from(
    JSON.stringify({
      roomName: params.room?.roomName,
      identity: params.participantIdentity,
      name: params.participantName,
      role: params.role,
      pushToTalk: params.pushToTalk,
      exp,
      provider: "LIVEKIT_MOCK"
    })
  ).toString("base64url");
  return {
    token: `lk_mock.${fallbackPayload}`,
    provider: "LIVEKIT_MOCK"
  };
}

export async function createStudioRoom(projectIdOrV2Id: string, input: z.infer<typeof StudioRoomCreateSchema>) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const roomName = buildRoomName(ctx.projectV2.id, input.name);
  const templateConfig = buildStudioRoomTemplateConfig(input.template);
  const room = await prisma.studioRoom.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      hostUserId: ctx.user.id,
      provider: "LIVEKIT_MANAGED",
      roomName,
      metadata: {
        title: sanitizeOverlayText(input.name ?? `${ctx.projectV2.title} Studio`, "Studio room"),
        region: input.region ?? "auto",
        template: templateConfig.id,
        captureProfile: templateConfig.captureProfile,
        recordingSafety: templateConfig.recordingSafety,
        rolePolicies: templateConfig.defaultRoles.map((role) => buildStudioRolePolicy(role)),
        controlRoom: {
          pushToTalkEnabled: templateConfig.recordingSafety.enforcePushToTalk,
          issues: [],
          actionHistory: []
        },
        ...(input.metadata ?? {})
      }
    }
  });

  await prisma.studioParticipant.create({
    data: {
      roomId: room.id,
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      userId: ctx.user.id,
      role: "HOST",
      displayName: ctx.user.email.split("@")[0] ?? "host",
      externalParticipantId: `host-${ctx.user.id.slice(-8)}`,
      trackMetadata: {
        role: "HOST",
        invitedVia: "room_create"
      }
    }
  });

  await recordWorkspaceAuditEvent({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: "studio.room.create",
    targetType: "studio_room",
    targetId: room.id,
    details: {
      provider: room.provider,
      roomName: room.roomName,
      template: templateConfig.id
    }
  });

  return {
    room: {
      id: room.id,
      projectId: ctx.projectV2.id,
      provider: room.provider,
      roomName: room.roomName,
      status: room.status,
      metadata: room.metadata,
      createdAt: room.createdAt.toISOString()
    }
  };
}

export async function getStudioRoom(projectIdOrV2Id: string, roomId: string) {
  const { ctx, room } = await requireStudioRoom(projectIdOrV2Id, roomId);
  const participants = await prisma.studioParticipant.findMany({
    where: {
      roomId: room.id
    },
    orderBy: {
      joinedAt: "asc"
    }
  });
  const metadata = asRecord(room.metadata);
  const templateConfig = buildStudioRoomTemplateConfig(asString(metadata.template, "podcast"));
  const roleCounts = countRoles(participants.map((participant) => ({
    id: participant.id,
    role: participant.role,
    displayName: participant.displayName,
    userId: participant.userId,
    leftAt: participant.leftAt,
    trackMetadata: participant.trackMetadata
  })));
  const controlRoom = roomControlMetadata(room.metadata);
  const safety = evaluateStudioRoomSafetyChecks({
    template: templateConfig.id,
    roomStatus: room.status,
    participantRoleCounts: roleCounts,
    pushToTalkEnabled: controlRoom.pushToTalkEnabled
  });

  return {
    room: {
      id: room.id,
      projectId: ctx.projectV2.id,
      provider: room.provider,
      roomName: room.roomName,
      status: room.status,
      metadata: room.metadata,
      template: templateConfig,
      startedAt: room.startedAt?.toISOString() ?? null,
      endedAt: room.endedAt?.toISOString() ?? null,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString()
    },
    roleCounts,
    safety,
    participants: participants.map((participant) => ({
      id: participant.id,
      userId: participant.userId,
      role: resolvedParticipantRole({
        role: participant.role,
        trackMetadata: participant.trackMetadata
      }),
      policy: buildStudioRolePolicy(resolvedParticipantRole({
        role: participant.role,
        trackMetadata: participant.trackMetadata
      })),
      displayName: participant.displayName,
      externalParticipantId: participant.externalParticipantId,
      joinedAt: participant.joinedAt.toISOString(),
      leftAt: participant.leftAt?.toISOString() ?? null,
      trackMetadata: participant.trackMetadata
    }))
  };
}

export async function issueStudioJoinToken(params: {
  projectIdOrV2Id: string;
  roomId: string;
  participantName: string;
  role: StudioRole;
  pushToTalk?: boolean;
  ttlSec: number;
}) {
  const { ctx, room } = await requireStudioRoom(params.projectIdOrV2Id, params.roomId);
  const role = normalizeStudioRole(params.role);
  const storageRole = resolveStudioStorageRole(role);
  const roomMeta = roomControlMetadata(room.metadata);
  const pushToTalk = params.pushToTalk ?? roomMeta.pushToTalkEnabled;
  const participantIdentity = `studio-${randomUUID()}`;
  const signed = await signLivekitToken({
    room,
    participantIdentity,
    participantName: params.participantName,
    role,
    pushToTalk,
    ttlSec: params.ttlSec
  });

  const participant = await prisma.studioParticipant.create({
    data: {
      roomId: room.id,
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      userId: ctx.user.id,
      role: storageRole,
      displayName: sanitizeOverlayText(params.participantName, "participant"),
      externalParticipantId: participantIdentity,
      trackMetadata: {
        issueTokenAt: new Date().toISOString(),
        role,
        pushToTalk
      }
    }
  });

  await recordWorkspaceAuditEvent({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: "studio.room.join_token",
    targetType: "studio_room",
    targetId: room.id,
    details: {
      participantId: participant.id,
      role,
      provider: signed.provider
    }
  });

  return {
    join: {
      roomId: room.id,
      roomName: room.roomName,
      provider: room.provider,
      livekitUrl: env.LIVEKIT_URL ?? null,
      token: signed.token,
      expiresInSec: params.ttlSec,
      participant: {
        id: participant.id,
        identity: participantIdentity,
        displayName: participant.displayName,
        role,
        policy: buildStudioRolePolicy(role)
      }
    }
  };
}

export async function startStudioRecording(projectIdOrV2Id: string, roomId: string) {
  const { ctx, room } = await requireStudioRoom(projectIdOrV2Id, roomId);
  const participants = await prisma.studioParticipant.findMany({
    where: { roomId: room.id, leftAt: null },
    select: {
      id: true,
      role: true,
      displayName: true,
      userId: true,
      leftAt: true,
      trackMetadata: true
    }
  });
  const roomMeta = asRecord(room.metadata);
  const template = buildStudioRoomTemplateConfig(asString(roomMeta.template, "podcast"));
  const roleCounts = countRoles(participants.map((participant) => ({
    id: participant.id,
    role: participant.role,
    displayName: participant.displayName,
    userId: participant.userId,
    leftAt: participant.leftAt,
    trackMetadata: participant.trackMetadata
  })));
  const currentControl = roomControlMetadata(room.metadata);
  const safety = evaluateStudioRoomSafetyChecks({
    template: template.id,
    roomStatus: room.status,
    participantRoleCounts: roleCounts,
    pushToTalkEnabled: currentControl.pushToTalkEnabled
  });
  if (!safety.canStartRecording) {
    const failed = safety.checks.find((check) => check.status === "FAIL");
    throw new Error(failed?.message ?? "Safety check failed");
  }

  const updated = await prisma.studioRoom.update({
    where: { id: room.id },
    data: {
      status: "ACTIVE",
      startedAt: room.startedAt ?? new Date(),
      endedAt: null,
      metadata: {
        ...(room.metadata && typeof room.metadata === "object" ? room.metadata : {}),
        recording: "started",
        recordingStartedAt: new Date().toISOString(),
        controlRoom: {
          ...currentControl.controlRoom,
          lastSafetyChecks: safety.checks,
          lastSafetyCheckAt: new Date().toISOString()
        }
      }
    }
  });
  await recordWorkspaceAuditEvent({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: "studio.room.recording.start",
    targetType: "studio_room",
    targetId: room.id,
    details: {
      roleCounts,
      safetyChecksPassed: safety.checks.filter((check) => check.status === "PASS").length,
      safetyChecksWarned: safety.checks.filter((check) => check.status === "WARN").length
    }
  });
  return {
    started: true,
    room: {
      id: updated.id,
      status: updated.status,
      startedAt: updated.startedAt?.toISOString() ?? null
    },
    safety
  };
}

export async function stopStudioRecording(projectIdOrV2Id: string, roomId: string) {
  const { ctx, room } = await requireStudioRoom(projectIdOrV2Id, roomId);
  const participants = await prisma.studioParticipant.findMany({
    where: { roomId: room.id }
  });

  const now = new Date();
  const updated = await prisma.studioRoom.update({
    where: { id: room.id },
    data: {
      status: "CLOSED",
      endedAt: now,
      metadata: {
        ...(room.metadata && typeof room.metadata === "object" ? room.metadata : {}),
        recording: "stopped"
      }
    }
  });

  const durationMs = computeDeterministicDurationMs(room.startedAt, now);
  const durationSec = Number((durationMs / 1000).toFixed(3));
  const resolvedParticipants = participants.map((participant) => ({
    id: participant.id,
    displayName: participant.displayName,
    role: resolvedParticipantRole({
      role: participant.role,
      trackMetadata: participant.trackMetadata
    })
  }));
  const mergePlan = buildDeterministicStudioMergePlan({
    durationMs,
    participants: resolvedParticipants
  });
  const artifactRows: Prisma.RemoteTrackArtifactCreateManyInput[] = participants.map((participant) => ({
    roomId: room.id,
    workspaceId: ctx.workspace.id,
    projectId: ctx.projectV2.id,
    participantId: participant.id,
    trackKind: "SPLIT_TRACK",
    durationSec,
    metadata: {
      participantName: participant.displayName,
      stoppedAt: now.toISOString()
    } as Prisma.InputJsonValue
  }));
  artifactRows.push({
    roomId: room.id,
    workspaceId: ctx.workspace.id,
    projectId: ctx.projectV2.id,
    participantId: null,
    trackKind: "MERGED_REFERENCE",
    durationSec,
    metadata: {
      roomName: room.roomName,
      stoppedAt: now.toISOString(),
      mergePlan
    } as Prisma.InputJsonValue
  });

  if (artifactRows.length > 0) {
    await prisma.remoteTrackArtifact.createMany({
      data: artifactRows
    });
  }

  let timelineLinked = false;
  let timelineClipCount = 0;
  const legacy = await prisma.project.findUnique({
    where: {
      id: ctx.legacyProject.id
    },
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
  });
  if (legacy) {
    const state = buildTimelineState(legacy.config, legacy.assets);
    const existingVideoTrack = state.tracks.find((track) => track.kind === "VIDEO") ?? null;
    const { ops } = buildStudioTrackOps({
      roomName: room.roomName,
      participants: participants.map((participant) => ({
        id: participant.id,
        displayName: participant.displayName
      })),
      durationMs,
      existingVideoTrackId: existingVideoTrack?.id ?? null,
      existingTracks: state.tracks.map((track) => ({
        id: track.id,
        kind: track.kind,
        name: track.name,
        order: track.order
      }))
    });
    if (ops.length > 0) {
      const applied = applyTimelineOperations(state, ops);
      const currentConfig = typeof legacy.config === "object" && legacy.config !== null
        ? (legacy.config as Record<string, unknown>)
        : {};
      const nextConfig = serializeTimelineState(currentConfig, applied.state);
      await prisma.project.update({
        where: {
          id: legacy.id
        },
        data: {
          config: nextConfig as never
        }
      });
      await appendTimelineRevision({
        projectId: ctx.projectV2.id,
        createdByUserId: ctx.user.id,
        operations: {
          source: "studio_room_stop_recording",
          roomId: room.id,
          durationSec,
          operations: ops
        }
      });
      timelineLinked = true;
      timelineClipCount = ops.filter((operation) => operation.op === "add_clip").length;
    }
  }

  await prisma.recordingRecovery.create({
    data: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      recordingSessionId: `studio-room-${room.id}`,
      status: "RESOLVED",
      reason: "studio_recording_stop",
      createdByUserId: ctx.user.id,
      metadata: {
        roomId: room.id,
        durationSec,
        mergePlanId: mergePlan.deterministicMergeId,
        mergeSegmentCount: mergePlan.segmentCount,
        participantCount: resolvedParticipants.length
      }
    }
  });

  await recordWorkspaceAuditEvent({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: "studio.room.recording.stop",
    targetType: "studio_room",
    targetId: room.id,
    details: {
      artifactCount: artifactRows.length,
      timelineLinked,
      timelineClipCount,
      mergePlanId: mergePlan.deterministicMergeId,
      mergeSegments: mergePlan.segmentCount
    }
  });

  return {
    stopped: true,
    room: {
      id: updated.id,
      status: updated.status,
      endedAt: updated.endedAt?.toISOString() ?? null
    },
    artifactsCreated: artifactRows.length,
    timeline: {
      linked: timelineLinked,
      generatedClipCount: timelineClipCount,
      durationSec
    },
    mergePlan
  };
}

function roomTemplateFromMetadata(metadata: unknown) {
  return buildStudioRoomTemplateConfig(asString(asRecord(metadata).template, "podcast"));
}

async function loadRoomParticipants(roomIds: string[]) {
  if (roomIds.length === 0) {
    return [] as Array<{
      id: string;
      roomId: string;
      userId: string | null;
      role: StudioStorageRole;
      displayName: string;
      externalParticipantId: string | null;
      joinedAt: Date;
      leftAt: Date | null;
      trackMetadata: unknown;
    }>;
  }
  return prisma.studioParticipant.findMany({
    where: {
      roomId: {
        in: roomIds
      }
    },
    orderBy: {
      joinedAt: "asc"
    }
  });
}

export async function getStudioControlRoomState(projectIdOrV2Id: string, roomId?: string) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const rooms = await prisma.studioRoom.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      ...(roomId ? { id: roomId } : {})
    },
    orderBy: {
      createdAt: "desc"
    },
    take: roomId ? 1 : 20
  });

  const roomIds = rooms.map((room) => room.id);
  const [participants, artifactGroups] = await Promise.all([
    loadRoomParticipants(roomIds),
    roomIds.length > 0
      ? prisma.remoteTrackArtifact.groupBy({
          by: ["roomId"],
          where: {
            roomId: {
              in: roomIds
            }
          },
          _count: {
            _all: true
          }
        })
      : []
  ]);

  const participantsByRoom = new Map<string, typeof participants>();
  for (const participant of participants) {
    const list = participantsByRoom.get(participant.roomId) ?? [];
    list.push(participant);
    participantsByRoom.set(participant.roomId, list);
  }
  const artifactsByRoom = new Map(artifactGroups.map((row) => [row.roomId, row._count._all]));

  const roomsWithDiagnostics = rooms.map((room) => {
    const roomParticipants = participantsByRoom.get(room.id) ?? [];
    const roleCounts = countRoles(roomParticipants.map((participant) => ({
      id: participant.id,
      role: participant.role,
      displayName: participant.displayName,
      userId: participant.userId,
      leftAt: participant.leftAt,
      trackMetadata: participant.trackMetadata
    })));
    const control = roomControlMetadata(room.metadata);
    const template = roomTemplateFromMetadata(room.metadata);
    const safety = evaluateStudioRoomSafetyChecks({
      template: template.id,
      roomStatus: room.status,
      participantRoleCounts: roleCounts,
      pushToTalkEnabled: control.pushToTalkEnabled
    });
    const activeIssues = control.issues.filter((issue) => issue.status !== "RESOLVED");
    const roleDiagnostics = buildRoleDiagnostics(roleCounts);
    const diagnostics = [
      ...roleDiagnostics,
      ...safety.checks
        .filter((check) => check.status !== "PASS")
        .map((check) => `${check.code}: ${check.message}`)
    ];
    const artifactCount = artifactsByRoom.get(room.id) ?? 0;
    const healthScore = deterministicHealthScore({
      participantRoleCounts: roleCounts,
      safety,
      artifactCount,
      activeIssueCount: activeIssues.length
    });

    return {
      id: room.id,
      roomName: room.roomName,
      status: room.status,
      participantCount: roomParticipants.length,
      artifactCount,
      roleCounts,
      template: template.id,
      pushToTalkEnabled: control.pushToTalkEnabled,
      activeIssues,
      healthScore,
      startedAt: room.startedAt?.toISOString() ?? null,
      endedAt: room.endedAt?.toISOString() ?? null,
      diagnostics,
      safety
    };
  });

  const allSafetyChecks = roomsWithDiagnostics.flatMap((room) => room.safety.checks);
  const safetyStats = {
    pass: allSafetyChecks.filter((check) => check.status === "PASS").length,
    warn: allSafetyChecks.filter((check) => check.status === "WARN").length,
    fail: allSafetyChecks.filter((check) => check.status === "FAIL").length
  };
  const roomHealthAvg = roomsWithDiagnostics.length > 0
    ? Number((roomsWithDiagnostics.reduce((sum, room) => sum + room.healthScore, 0) / roomsWithDiagnostics.length).toFixed(2))
    : 0;

  return {
    projectV2Id: ctx.projectV2.id,
    activeRoomCount: roomsWithDiagnostics.filter((room) => room.status === "ACTIVE").length,
    closedRoomCount: roomsWithDiagnostics.filter((room) => room.status === "CLOSED").length,
    safetyStats,
    reliability: {
      sessionSuccessTargetPct: 95,
      estimatedSessionSuccessPct: roomHealthAvg
    },
    rooms: roomsWithDiagnostics
  };
}

async function assertControlRoomOperator(params: {
  ctx: Awaited<ReturnType<typeof requireProjectContext>>;
  roomId: string;
}) {
  const participant = await prisma.studioParticipant.findFirst({
    where: {
      roomId: params.roomId,
      userId: params.ctx.user.id
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  if (!participant) {
    throw new Error("Unauthorized");
  }
  const role = resolvedParticipantRole({
    role: participant.role,
    trackMetadata: participant.trackMetadata
  });
  const policy = buildStudioRolePolicy(role);
  if (!policy.canControlRoom) {
    throw new Error("Unauthorized");
  }
  return {
    participant,
    role,
    policy
  };
}

export async function applyStudioControlRoomAction(projectIdOrV2Id: string, input: StudioControlRoomActionInput) {
  const ctx = await requireProjectContext(projectIdOrV2Id);
  const room = await prisma.studioRoom.findFirst({
    where: {
      id: input.roomId,
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id
    }
  });
  if (!room) {
    throw new Error("Studio room not found");
  }

  const operator = await assertControlRoomOperator({
    ctx,
    roomId: room.id
  });
  const control = roomControlMetadata(room.metadata);
  const now = new Date().toISOString();
  const issues = [...control.issues];
  let actionResult: Record<string, unknown> = {};

  if (input.action === "participant_mute" || input.action === "participant_unmute") {
    if (!input.participantId) {
      throw new Error("participantId is required");
    }
    const target = await prisma.studioParticipant.findFirst({
      where: {
        id: input.participantId,
        roomId: room.id
      }
    });
    if (!target) {
      throw new Error("Participant not found");
    }
    const targetMeta = asRecord(target.trackMetadata);
    const nextMuted = input.action === "participant_mute";
    await prisma.studioParticipant.update({
      where: { id: target.id },
      data: {
        trackMetadata: {
          ...targetMeta,
          mutedByControlRoom: nextMuted,
          mutedAt: nextMuted ? now : null
        }
      }
    });
    actionResult = {
      participantId: target.id,
      muted: nextMuted
    };
  } else if (input.action === "participant_remove") {
    if (!input.participantId) {
      throw new Error("participantId is required");
    }
    await prisma.studioParticipant.updateMany({
      where: {
        id: input.participantId,
        roomId: room.id
      },
      data: {
        leftAt: new Date()
      }
    });
    actionResult = {
      participantId: input.participantId,
      removed: true
    };
  } else if (input.action === "push_to_talk_enable" || input.action === "push_to_talk_disable") {
    actionResult = {
      pushToTalkEnabled: input.action === "push_to_talk_enable"
    };
  } else if (input.action === "mark_issue") {
    if (!input.note) {
      throw new Error("note is required");
    }
    issues.push({
      id: `issue-${randomUUID().slice(0, 12)}`,
      note: sanitizeOverlayText(input.note, ""),
      status: "OPEN",
      createdAt: now
    });
    actionResult = {
      issueCount: issues.length
    };
  } else if (input.action === "resolve_issue") {
    if (!input.issueId) {
      throw new Error("issueId is required");
    }
    const issue = issues.find((entry) => entry.id === input.issueId);
    if (issue) {
      issue.status = "RESOLVED";
    }
    actionResult = {
      resolvedIssueId: input.issueId
    };
  }

  const actionHistoryEntry = {
    id: `action-${randomUUID().slice(0, 12)}`,
    action: input.action,
    actorUserId: ctx.user.id,
    actorRole: operator.role,
    createdAt: now,
    participantId: input.participantId ?? null,
    issueId: input.issueId ?? null,
    note: input.note ?? null
  };
  const actionHistory = [...control.actionHistory, actionHistoryEntry].slice(-50);
  const nextPushToTalk = input.action === "push_to_talk_enable"
    ? true
    : input.action === "push_to_talk_disable"
      ? false
      : control.pushToTalkEnabled;

  await prisma.studioRoom.update({
    where: { id: room.id },
    data: {
      metadata: {
        ...control.metadata,
        controlRoom: {
          ...control.controlRoom,
          pushToTalkEnabled: nextPushToTalk,
          issues,
          actionHistory,
          lastActionAt: now
        }
      } as Prisma.InputJsonValue
    }
  });

  await recordWorkspaceAuditEvent({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: `studio.control_room.${input.action}`,
    targetType: "studio_room",
    targetId: room.id,
    details: {
      roomId: room.id,
      participantId: input.participantId ?? null,
      issueId: input.issueId ?? null
    }
  });

  const state = await getStudioControlRoomState(projectIdOrV2Id, room.id);
  return {
    action: input.action,
    roomId: room.id,
    actorRole: operator.role,
    result: actionResult,
    state
  };
}
