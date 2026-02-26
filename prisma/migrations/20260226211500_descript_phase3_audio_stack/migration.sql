-- Descript 6-month Phase 3: audio quality stack (additive)

CREATE TYPE "AudioEnhancementPreset" AS ENUM ('CLEAN_VOICE', 'DIALOGUE_ENHANCE', 'BROADCAST_LOUDNESS', 'CUSTOM');
CREATE TYPE "AudioEnhancementMode" AS ENUM ('PREVIEW', 'APPLY');
CREATE TYPE "AudioEnhancementOperation" AS ENUM ('ENHANCE', 'FILLER_REMOVE');
CREATE TYPE "AudioEnhancementRunStatus" AS ENUM ('PREVIEWED', 'APPLIED', 'ERROR');
CREATE TYPE "FillerCandidateStatus" AS ENUM ('DETECTED', 'PREVIEWED', 'APPLIED', 'SKIPPED');

CREATE TABLE "AudioEnhancementRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "timelineRevisionId" TEXT,
  "mode" "AudioEnhancementMode" NOT NULL,
  "operation" "AudioEnhancementOperation" NOT NULL,
  "preset" "AudioEnhancementPreset",
  "status" "AudioEnhancementRunStatus" NOT NULL DEFAULT 'PREVIEWED',
  "config" JSONB NOT NULL,
  "summary" JSONB,
  "undoToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudioEnhancementRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FillerCandidate" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "segmentId" TEXT,
  "wordId" TEXT,
  "text" TEXT NOT NULL,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "confidence" DOUBLE PRECISION,
  "status" "FillerCandidateStatus" NOT NULL DEFAULT 'DETECTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FillerCandidate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AudioEnhancementRun_workspaceId_createdAt_idx" ON "AudioEnhancementRun"("workspaceId", "createdAt");
CREATE INDEX "AudioEnhancementRun_projectId_createdAt_idx" ON "AudioEnhancementRun"("projectId", "createdAt");
CREATE INDEX "AudioEnhancementRun_timelineRevisionId_idx" ON "AudioEnhancementRun"("timelineRevisionId");
CREATE INDEX "FillerCandidate_runId_idx" ON "FillerCandidate"("runId");
CREATE INDEX "FillerCandidate_workspaceId_createdAt_idx" ON "FillerCandidate"("workspaceId", "createdAt");
CREATE INDEX "FillerCandidate_projectId_language_startMs_idx" ON "FillerCandidate"("projectId", "language", "startMs");
CREATE INDEX "FillerCandidate_segmentId_idx" ON "FillerCandidate"("segmentId");
CREATE INDEX "FillerCandidate_wordId_idx" ON "FillerCandidate"("wordId");

ALTER TABLE "AudioEnhancementRun"
  ADD CONSTRAINT "AudioEnhancementRun_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioEnhancementRun"
  ADD CONSTRAINT "AudioEnhancementRun_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudioEnhancementRun"
  ADD CONSTRAINT "AudioEnhancementRun_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AudioEnhancementRun"
  ADD CONSTRAINT "AudioEnhancementRun_timelineRevisionId_fkey"
  FOREIGN KEY ("timelineRevisionId") REFERENCES "TimelineRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FillerCandidate"
  ADD CONSTRAINT "FillerCandidate_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AudioEnhancementRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FillerCandidate"
  ADD CONSTRAINT "FillerCandidate_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FillerCandidate"
  ADD CONSTRAINT "FillerCandidate_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FillerCandidate"
  ADD CONSTRAINT "FillerCandidate_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "TranscriptSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FillerCandidate"
  ADD CONSTRAINT "FillerCandidate_wordId_fkey"
  FOREIGN KEY ("wordId") REFERENCES "TranscriptWord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
