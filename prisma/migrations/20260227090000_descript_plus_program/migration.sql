-- Descript+ 9-month program foundation tables

CREATE TYPE "StudioRoomStatus" AS ENUM ('ACTIVE', 'CLOSED');
CREATE TYPE "StudioParticipantRole" AS ENUM ('HOST', 'GUEST');
CREATE TYPE "RecordingRecoveryStatus" AS ENUM ('OPEN', 'RESOLVED', 'FAILED');
CREATE TYPE "TranscriptIssueType" AS ENUM ('LOW_CONFIDENCE', 'OVERLAP', 'TIMING_DRIFT');
CREATE TYPE "AutopilotActionType" AS ENUM ('PLAN', 'APPLY', 'UNDO');
CREATE TYPE "AutopilotActionStatus" AS ENUM ('SUCCESS', 'FAILED', 'SUGGESTIONS_ONLY');
CREATE TYPE "ReviewRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "PublishJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'ERROR');
CREATE TYPE "ParityBenchmarkStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'ERROR');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReviewDecisionStatus') THEN
    CREATE TYPE "ReviewDecisionStatus" AS ENUM ('APPROVED', 'REJECTED');
  END IF;
END $$;

CREATE TABLE "StudioRoom" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "hostUserId" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'LIVEKIT_MANAGED',
  "roomName" TEXT NOT NULL,
  "status" "StudioRoomStatus" NOT NULL DEFAULT 'ACTIVE',
  "metadata" JSONB,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioRoom_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudioParticipant" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT,
  "role" "StudioParticipantRole" NOT NULL DEFAULT 'GUEST',
  "displayName" TEXT NOT NULL,
  "externalParticipantId" TEXT,
  "trackMetadata" JSONB,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RemoteTrackArtifact" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "participantId" TEXT,
  "mediaAssetId" TEXT,
  "storageKey" TEXT,
  "trackKind" TEXT NOT NULL,
  "durationSec" DOUBLE PRECISION,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RemoteTrackArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecordingRecovery" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordingSessionId" TEXT NOT NULL,
  "status" "RecordingRecoveryStatus" NOT NULL DEFAULT 'OPEN',
  "reason" TEXT,
  "metadata" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecordingRecovery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TranscriptEditCheckpoint" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptEditCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TranscriptConflictIssue" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "checkpointId" TEXT,
  "issueType" "TranscriptIssueType" NOT NULL,
  "severity" "TrustSeverity" NOT NULL DEFAULT 'WARN',
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptConflictIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudioPresetProfile" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AudioPresetProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudioEnhancementRunV2" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sourceRunId" TEXT,
  "operation" "AudioEnhancementOperation" NOT NULL,
  "mode" "AudioEnhancementMode" NOT NULL,
  "status" "AudioEnhancementRunStatus" NOT NULL DEFAULT 'PREVIEWED',
  "summary" JSONB,
  "metadata" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AudioEnhancementRunV2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopilotSession" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "sourcePlanId" TEXT,
  "planRevisionHash" TEXT NOT NULL,
  "safetyMode" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "status" "AutopilotActionStatus" NOT NULL DEFAULT 'SUCCESS',
  "metadata" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutopilotSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopilotAction" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "actionType" "AutopilotActionType" NOT NULL,
  "status" "AutopilotActionStatus" NOT NULL DEFAULT 'SUCCESS',
  "payload" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutopilotAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewRequest" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "title" TEXT NOT NULL,
  "note" TEXT,
  "requiredScopes" TEXT[] NOT NULL DEFAULT ARRAY['APPROVE']::TEXT[],
  "status" "ReviewRequestStatus" NOT NULL DEFAULT 'PENDING',
  "decisionId" TEXT,
  "metadata" JSONB,
  "decidedAt" TIMESTAMP(3),
  "decidedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewDecisionLog" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "decidedByUserId" TEXT,
  "status" "ReviewDecisionStatus" NOT NULL,
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewDecisionLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublishConnectorJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "exportProfileId" TEXT,
  "connector" TEXT NOT NULL,
  "status" "PublishJobStatus" NOT NULL DEFAULT 'QUEUED',
  "payload" JSONB,
  "output" JSONB,
  "errorMessage" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublishConnectorJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParityBenchmarkRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "status" "ParityBenchmarkStatus" NOT NULL DEFAULT 'QUEUED',
  "modules" TEXT[] NOT NULL,
  "summary" JSONB,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParityBenchmarkRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParityBenchmarkResult" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParityBenchmarkResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudioRoom_projectId_roomName_key" ON "StudioRoom"("projectId", "roomName");
CREATE INDEX "StudioRoom_workspaceId_createdAt_idx" ON "StudioRoom"("workspaceId", "createdAt");
CREATE INDEX "StudioRoom_projectId_status_createdAt_idx" ON "StudioRoom"("projectId", "status", "createdAt");

CREATE INDEX "StudioParticipant_roomId_joinedAt_idx" ON "StudioParticipant"("roomId", "joinedAt");
CREATE INDEX "StudioParticipant_workspaceId_createdAt_idx" ON "StudioParticipant"("workspaceId", "createdAt");
CREATE INDEX "StudioParticipant_projectId_joinedAt_idx" ON "StudioParticipant"("projectId", "joinedAt");

CREATE INDEX "RemoteTrackArtifact_roomId_createdAt_idx" ON "RemoteTrackArtifact"("roomId", "createdAt");
CREATE INDEX "RemoteTrackArtifact_projectId_createdAt_idx" ON "RemoteTrackArtifact"("projectId", "createdAt");

CREATE INDEX "RecordingRecovery_workspaceId_createdAt_idx" ON "RecordingRecovery"("workspaceId", "createdAt");
CREATE INDEX "RecordingRecovery_projectId_recordingSessionId_createdAt_idx" ON "RecordingRecovery"("projectId", "recordingSessionId", "createdAt");

CREATE INDEX "TranscriptEditCheckpoint_workspaceId_createdAt_idx" ON "TranscriptEditCheckpoint"("workspaceId", "createdAt");
CREATE INDEX "TranscriptEditCheckpoint_projectId_language_createdAt_idx" ON "TranscriptEditCheckpoint"("projectId", "language", "createdAt");

CREATE INDEX "TranscriptConflictIssue_workspaceId_createdAt_idx" ON "TranscriptConflictIssue"("workspaceId", "createdAt");
CREATE INDEX "TranscriptConflictIssue_projectId_issueType_createdAt_idx" ON "TranscriptConflictIssue"("projectId", "issueType", "createdAt");
CREATE INDEX "TranscriptConflictIssue_checkpointId_idx" ON "TranscriptConflictIssue"("checkpointId");

CREATE UNIQUE INDEX "AudioPresetProfile_workspaceId_name_key" ON "AudioPresetProfile"("workspaceId", "name");
CREATE INDEX "AudioPresetProfile_workspaceId_createdAt_idx" ON "AudioPresetProfile"("workspaceId", "createdAt");

CREATE INDEX "AudioEnhancementRunV2_workspaceId_createdAt_idx" ON "AudioEnhancementRunV2"("workspaceId", "createdAt");
CREATE INDEX "AudioEnhancementRunV2_projectId_createdAt_idx" ON "AudioEnhancementRunV2"("projectId", "createdAt");

CREATE INDEX "AutopilotSession_workspaceId_createdAt_idx" ON "AutopilotSession"("workspaceId", "createdAt");
CREATE INDEX "AutopilotSession_projectId_createdAt_idx" ON "AutopilotSession"("projectId", "createdAt");

CREATE INDEX "AutopilotAction_workspaceId_createdAt_idx" ON "AutopilotAction"("workspaceId", "createdAt");
CREATE INDEX "AutopilotAction_projectId_createdAt_idx" ON "AutopilotAction"("projectId", "createdAt");
CREATE INDEX "AutopilotAction_sessionId_createdAt_idx" ON "AutopilotAction"("sessionId", "createdAt");

CREATE INDEX "ReviewRequest_workspaceId_createdAt_idx" ON "ReviewRequest"("workspaceId", "createdAt");
CREATE INDEX "ReviewRequest_projectId_status_createdAt_idx" ON "ReviewRequest"("projectId", "status", "createdAt");

CREATE INDEX "ReviewDecisionLog_workspaceId_createdAt_idx" ON "ReviewDecisionLog"("workspaceId", "createdAt");
CREATE INDEX "ReviewDecisionLog_projectId_createdAt_idx" ON "ReviewDecisionLog"("projectId", "createdAt");
CREATE INDEX "ReviewDecisionLog_requestId_createdAt_idx" ON "ReviewDecisionLog"("requestId", "createdAt");

CREATE INDEX "PublishConnectorJob_workspaceId_createdAt_idx" ON "PublishConnectorJob"("workspaceId", "createdAt");
CREATE INDEX "PublishConnectorJob_projectId_status_createdAt_idx" ON "PublishConnectorJob"("projectId", "status", "createdAt");

CREATE INDEX "ParityBenchmarkRun_workspaceId_createdAt_idx" ON "ParityBenchmarkRun"("workspaceId", "createdAt");
CREATE INDEX "ParityBenchmarkRun_status_createdAt_idx" ON "ParityBenchmarkRun"("status", "createdAt");

CREATE INDEX "ParityBenchmarkResult_runId_createdAt_idx" ON "ParityBenchmarkResult"("runId", "createdAt");
CREATE INDEX "ParityBenchmarkResult_module_createdAt_idx" ON "ParityBenchmarkResult"("module", "createdAt");
