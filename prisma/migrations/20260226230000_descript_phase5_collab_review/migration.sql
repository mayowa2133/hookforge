-- CreateEnum
CREATE TYPE "ShareLinkScope" AS ENUM ('VIEW', 'COMMENT', 'APPROVE');

-- CreateEnum
CREATE TYPE "ReviewCommentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReviewDecisionStatus" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ShareLink" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "token" TEXT NOT NULL,
  "scope" "ShareLinkScope" NOT NULL DEFAULT 'VIEW',
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewComment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "authorUserId" TEXT,
  "shareLinkId" TEXT,
  "body" TEXT NOT NULL,
  "status" "ReviewCommentStatus" NOT NULL DEFAULT 'OPEN',
  "anchorMs" INTEGER,
  "transcriptStartMs" INTEGER,
  "transcriptEndMs" INTEGER,
  "timelineTrackId" TEXT,
  "clipId" TEXT,
  "metadata" JSONB,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "revisionId" TEXT,
  "decidedByUserId" TEXT,
  "status" "ReviewDecisionStatus" NOT NULL,
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportProfile" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "name" TEXT NOT NULL,
  "container" TEXT NOT NULL DEFAULT 'mp4',
  "resolution" TEXT NOT NULL DEFAULT '1080x1920',
  "fps" INTEGER NOT NULL DEFAULT 30,
  "videoBitrateKbps" INTEGER,
  "audioBitrateKbps" INTEGER,
  "audioPreset" TEXT,
  "captionStylePresetId" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExportProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_workspaceId_createdAt_idx" ON "ShareLink"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ShareLink_projectId_scope_createdAt_idx" ON "ShareLink"("projectId", "scope", "createdAt");

-- CreateIndex
CREATE INDEX "ShareLink_token_revokedAt_expiresAt_idx" ON "ShareLink"("token", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "ReviewComment_workspaceId_createdAt_idx" ON "ReviewComment"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewComment_projectId_status_createdAt_idx" ON "ReviewComment"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewComment_shareLinkId_idx" ON "ReviewComment"("shareLinkId");

-- CreateIndex
CREATE INDEX "ReviewDecision_workspaceId_createdAt_idx" ON "ReviewDecision"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewDecision_projectId_createdAt_idx" ON "ReviewDecision"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewDecision_projectId_status_createdAt_idx" ON "ReviewDecision"("projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExportProfile_workspaceId_name_key" ON "ExportProfile"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ExportProfile_workspaceId_isDefault_idx" ON "ExportProfile"("workspaceId", "isDefault");

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "TimelineRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportProfile" ADD CONSTRAINT "ExportProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportProfile" ADD CONSTRAINT "ExportProfile_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportProfile" ADD CONSTRAINT "ExportProfile_captionStylePresetId_fkey" FOREIGN KEY ("captionStylePresetId") REFERENCES "CaptionStylePreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
