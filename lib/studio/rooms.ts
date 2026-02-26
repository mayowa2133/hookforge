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

export const StudioRoomCreateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  region: z.string().trim().min(2).max(24).optional(),
  metadata: z.record(z.unknown()).optional()
});

export const StudioJoinTokenSchema = z.object({
  participantName: z.string().trim().min(1).max(80),
  role: z.enum(["HOST", "GUEST"]).default("GUEST"),
  ttlSec: z.number().int().min(60).max(60 * 60 * 6).default(60 * 60)
});

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
};

type RoomRecord = Awaited<ReturnType<typeof prisma.studioRoom.findFirst>>;

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
    prisma.studioParticipant.groupBy({
      by: ["roomId"],
      where: {
        roomId: {
          in: roomIds
        }
      },
      _count: {
        _all: true
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

  const participantCountByRoom = new Map(participants.map((row) => [row.roomId, row._count._all]));
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
      artifactCount: artifactCountByRoom.get(room.id) ?? 0
    }))
  };
}

async function signLivekitToken(params: {
  room: RoomRecord;
  participantIdentity: string;
  participantName: string;
  role: "HOST" | "GUEST";
  ttlSec: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + params.ttlSec;
  if (env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) {
    const token = await new SignJWT({
      video: {
        roomJoin: true,
        room: params.room?.roomName,
        canPublish: true,
        canSubscribe: true
      },
      metadata: JSON.stringify({
        role: params.role
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
      externalParticipantId: `host-${ctx.user.id.slice(-8)}`
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
      roomName: room.roomName
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
  return {
    room: {
      id: room.id,
      projectId: ctx.projectV2.id,
      provider: room.provider,
      roomName: room.roomName,
      status: room.status,
      metadata: room.metadata,
      startedAt: room.startedAt?.toISOString() ?? null,
      endedAt: room.endedAt?.toISOString() ?? null,
      createdAt: room.createdAt.toISOString(),
      updatedAt: room.updatedAt.toISOString()
    },
    participants: participants.map((participant) => ({
      id: participant.id,
      userId: participant.userId,
      role: participant.role,
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
  role: "HOST" | "GUEST";
  ttlSec: number;
}) {
  const { ctx, room } = await requireStudioRoom(params.projectIdOrV2Id, params.roomId);
  const participantIdentity = `studio-${randomUUID()}`;
  const signed = await signLivekitToken({
    room,
    participantIdentity,
    participantName: params.participantName,
    role: params.role,
    ttlSec: params.ttlSec
  });

  const participant = await prisma.studioParticipant.create({
    data: {
      roomId: room.id,
      workspaceId: ctx.workspace.id,
      projectId: ctx.projectV2.id,
      userId: ctx.user.id,
      role: params.role,
      displayName: sanitizeOverlayText(params.participantName, "participant"),
      externalParticipantId: participantIdentity,
      trackMetadata: {
        issueTokenAt: new Date().toISOString()
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
      role: params.role,
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
        role: participant.role
      }
    }
  };
}

export async function startStudioRecording(projectIdOrV2Id: string, roomId: string) {
  const { ctx, room } = await requireStudioRoom(projectIdOrV2Id, roomId);
  const updated = await prisma.studioRoom.update({
    where: { id: room.id },
    data: {
      status: "ACTIVE",
      startedAt: room.startedAt ?? new Date(),
      endedAt: null,
      metadata: {
        ...(room.metadata && typeof room.metadata === "object" ? room.metadata : {}),
        recording: "started"
      }
    }
  });
  await recordWorkspaceAuditEvent({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: "studio.room.recording.start",
    targetType: "studio_room",
    targetId: room.id
  });
  return {
    started: true,
    room: {
      id: updated.id,
      status: updated.status,
      startedAt: updated.startedAt?.toISOString() ?? null
    }
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
      stoppedAt: now.toISOString()
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

  await recordWorkspaceAuditEvent({
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: "studio.room.recording.stop",
    targetType: "studio_room",
    targetId: room.id,
    details: {
      artifactCount: artifactRows.length,
      timelineLinked,
      timelineClipCount
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
    }
  };
}
