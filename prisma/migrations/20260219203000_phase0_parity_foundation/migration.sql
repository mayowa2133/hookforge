-- Enums
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER');
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');
CREATE TYPE "CreditEntryType" AS ENUM ('CREDIT', 'DEBIT', 'ADJUSTMENT', 'REFUND');
CREATE TYPE "MediaSource" AS ENUM ('UPLOAD', 'URL_IMPORT', 'GENERATED');
CREATE TYPE "MediaArtifactKind" AS ENUM ('ORIGINAL', 'NORMALIZED', 'PREVIEW', 'THUMBNAIL', 'TRANSCRIPT', 'CAPTIONS', 'DUBBED', 'LIPSYNC', 'OUTPUT');
CREATE TYPE "SourceLinkType" AS ENUM ('WEBSITE', 'YOUTUBE', 'REDDIT', 'OTHER');
CREATE TYPE "TimelineTrackKind" AS ENUM ('VIDEO', 'AUDIO', 'CAPTION', 'EFFECT');
CREATE TYPE "ClipType" AS ENUM ('MEDIA', 'COLOR', 'GENERATOR', 'TEXT');
CREATE TYPE "AIJobType" AS ENUM ('INGEST_URL', 'TRANSCRIBE', 'CAPTION_TRANSLATE', 'AI_EDIT', 'CHAT_EDIT', 'AI_CREATOR', 'AI_ADS', 'AI_SHORTS', 'DUBBING', 'LIPSYNC', 'EYE_CONTACT', 'DENOISE');
CREATE TYPE "AIJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'ERROR', 'CANCELED');
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'REVOKED');
CREATE TYPE "TrustEventType" AS ENUM ('RIGHTS_ATTESTED', 'CONSENT_SUBMITTED', 'CONSENT_VERIFIED', 'CONTENT_FLAGGED', 'CONTENT_TAKEDOWN', 'POLICY_VIOLATION');
CREATE TYPE "TrustSeverity" AS ENUM ('INFO', 'WARN', 'HIGH', 'CRITICAL');
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- New columns
ALTER TABLE "Project" ADD COLUMN "workspaceId" TEXT;

-- Tables
CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMember" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'EDITOR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "monthlyCredits" INTEGER NOT NULL,
  "trialDays" INTEGER,
  "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "planId" TEXT,
  "provider" TEXT NOT NULL,
  "externalReference" TEXT,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditWallet" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditWallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditLedgerEntry" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "entryType" "CreditEntryType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectV2" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "legacyProjectId" TEXT,
  "createdByUserId" TEXT,
  "title" TEXT NOT NULL,
  "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "currentRevisionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectV2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimelineRevision" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL,
  "operations" JSONB NOT NULL,
  "timelineHash" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimelineRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimelineTrack" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "revisionId" TEXT,
  "kind" "TimelineTrackKind" NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "volumeDb" DOUBLE PRECISION,
  "isMuted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimelineTrack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Clip" (
  "id" TEXT NOT NULL,
  "trackId" TEXT NOT NULL,
  "clipType" "ClipType" NOT NULL DEFAULT 'MEDIA',
  "mediaAssetId" TEXT,
  "label" TEXT,
  "timelineInMs" INTEGER NOT NULL,
  "timelineOutMs" INTEGER NOT NULL,
  "sourceInMs" INTEGER NOT NULL,
  "sourceOutMs" INTEGER NOT NULL,
  "transform" JSONB,
  "audio" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Effect" (
  "id" TEXT NOT NULL,
  "clipId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Effect_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Keyframe" (
  "id" TEXT NOT NULL,
  "effectId" TEXT NOT NULL,
  "property" TEXT NOT NULL,
  "timeMs" INTEGER NOT NULL,
  "value" JSONB NOT NULL,
  "easing" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Keyframe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "source" "MediaSource" NOT NULL DEFAULT 'UPLOAD',
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT,
  "durationSec" DOUBLE PRECISION,
  "width" INTEGER,
  "height" INTEGER,
  "sha256" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MediaArtifact" (
  "id" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "kind" "MediaArtifactKind" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IngestionSourceLink" (
  "id" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "sourceType" "SourceLinkType" NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "canonicalUrl" TEXT,
  "rightsAttested" BOOLEAN NOT NULL DEFAULT false,
  "importedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IngestionSourceLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TranscriptWord" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "speakerLabel" TEXT,
  "confidence" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranscriptWord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CaptionStylePreset" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaptionStylePreset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CaptionSegment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "trackId" TEXT,
  "language" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "stylePresetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaptionSegment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "type" "AIJobType" NOT NULL,
  "status" "AIJobStatus" NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "providerHint" TEXT,
  "input" JSONB NOT NULL,
  "output" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIProviderRun" (
  "id" TEXT NOT NULL,
  "aiJobId" TEXT NOT NULL,
  "providerName" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "model" TEXT,
  "request" JSONB,
  "response" JSONB,
  "tokensIn" INTEGER,
  "tokensOut" INTEGER,
  "durationMs" INTEGER,
  "costUsd" DECIMAL(10,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIProviderRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIOperationResult" (
  "id" TEXT NOT NULL,
  "aiJobId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "outputStorageKey" TEXT,
  "output" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIOperationResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VoiceProfile" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerVoiceId" TEXT,
  "language" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoiceProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VoiceClone" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "voiceProfileId" TEXT NOT NULL,
  "consentVerificationId" TEXT,
  "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
  "sampleStorageKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoiceClone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AvatarProfile" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAvatarId" TEXT,
  "previewStorageKey" TEXT,
  "consentVerificationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvatarProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AITwin" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "avatarProfileId" TEXT,
  "voiceProfileId" TEXT,
  "consentVerificationId" TEXT,
  "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AITwin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RightsAttestation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceType" "SourceLinkType" NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "metadata" JSONB,
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RightsAttestation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsentVerification" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectName" TEXT NOT NULL,
  "subjectEmail" TEXT,
  "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
  "evidenceStorageKey" TEXT,
  "reviewedByUserId" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrustEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT,
  "eventType" "TrustEventType" NOT NULL,
  "severity" "TrustSeverity" NOT NULL DEFAULT 'INFO',
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrustEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicApiKey" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "name" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicApiKey_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");

CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

CREATE INDEX "Project_workspaceId_idx" ON "Project"("workspaceId");
CREATE INDEX "Plan_workspaceId_idx" ON "Plan"("workspaceId");
CREATE INDEX "Subscription_workspaceId_idx" ON "Subscription"("workspaceId");
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");
CREATE UNIQUE INDEX "CreditWallet_workspaceId_key" ON "CreditWallet"("workspaceId");
CREATE INDEX "CreditLedgerEntry_walletId_idx" ON "CreditLedgerEntry"("walletId");
CREATE INDEX "CreditLedgerEntry_workspaceId_createdAt_idx" ON "CreditLedgerEntry"("workspaceId", "createdAt");

CREATE UNIQUE INDEX "ProjectV2_legacyProjectId_key" ON "ProjectV2"("legacyProjectId");
CREATE INDEX "ProjectV2_workspaceId_idx" ON "ProjectV2"("workspaceId");
CREATE INDEX "ProjectV2_createdByUserId_idx" ON "ProjectV2"("createdByUserId");

CREATE UNIQUE INDEX "TimelineRevision_projectId_revisionNumber_key" ON "TimelineRevision"("projectId", "revisionNumber");
CREATE INDEX "TimelineRevision_projectId_idx" ON "TimelineRevision"("projectId");

CREATE INDEX "TimelineTrack_projectId_idx" ON "TimelineTrack"("projectId");
CREATE INDEX "TimelineTrack_revisionId_idx" ON "TimelineTrack"("revisionId");
CREATE INDEX "Clip_trackId_idx" ON "Clip"("trackId");
CREATE INDEX "Clip_mediaAssetId_idx" ON "Clip"("mediaAssetId");
CREATE INDEX "Effect_clipId_idx" ON "Effect"("clipId");
CREATE INDEX "Keyframe_effectId_idx" ON "Keyframe"("effectId");

CREATE INDEX "MediaAsset_workspaceId_idx" ON "MediaAsset"("workspaceId");
CREATE INDEX "MediaAsset_projectId_idx" ON "MediaAsset"("projectId");
CREATE INDEX "MediaArtifact_mediaAssetId_idx" ON "MediaArtifact"("mediaAssetId");
CREATE INDEX "IngestionSourceLink_mediaAssetId_idx" ON "IngestionSourceLink"("mediaAssetId");
CREATE INDEX "IngestionSourceLink_importedByUserId_idx" ON "IngestionSourceLink"("importedByUserId");

CREATE INDEX "TranscriptWord_projectId_startMs_idx" ON "TranscriptWord"("projectId", "startMs");
CREATE INDEX "CaptionStylePreset_workspaceId_idx" ON "CaptionStylePreset"("workspaceId");
CREATE INDEX "CaptionSegment_projectId_language_idx" ON "CaptionSegment"("projectId", "language");
CREATE INDEX "CaptionSegment_trackId_idx" ON "CaptionSegment"("trackId");

CREATE INDEX "AIJob_workspaceId_createdAt_idx" ON "AIJob"("workspaceId", "createdAt");
CREATE INDEX "AIJob_projectId_idx" ON "AIJob"("projectId");
CREATE INDEX "AIJob_status_idx" ON "AIJob"("status");
CREATE INDEX "AIProviderRun_aiJobId_idx" ON "AIProviderRun"("aiJobId");
CREATE INDEX "AIOperationResult_aiJobId_idx" ON "AIOperationResult"("aiJobId");

CREATE INDEX "VoiceProfile_workspaceId_idx" ON "VoiceProfile"("workspaceId");
CREATE INDEX "VoiceClone_workspaceId_idx" ON "VoiceClone"("workspaceId");
CREATE INDEX "VoiceClone_voiceProfileId_idx" ON "VoiceClone"("voiceProfileId");
CREATE INDEX "AvatarProfile_workspaceId_idx" ON "AvatarProfile"("workspaceId");
CREATE INDEX "AITwin_workspaceId_idx" ON "AITwin"("workspaceId");

CREATE INDEX "RightsAttestation_workspaceId_createdAt_idx" ON "RightsAttestation"("workspaceId", "createdAt");
CREATE INDEX "RightsAttestation_userId_idx" ON "RightsAttestation"("userId");
CREATE INDEX "ConsentVerification_workspaceId_status_idx" ON "ConsentVerification"("workspaceId", "status");
CREATE INDEX "TrustEvent_workspaceId_createdAt_idx" ON "TrustEvent"("workspaceId", "createdAt");

CREATE UNIQUE INDEX "PublicApiKey_keyHash_key" ON "PublicApiKey"("keyHash");
CREATE INDEX "PublicApiKey_workspaceId_idx" ON "PublicApiKey"("workspaceId");

-- Foreign keys
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Plan" ADD CONSTRAINT "Plan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditWallet" ADD CONSTRAINT "CreditWallet_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CreditWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectV2" ADD CONSTRAINT "ProjectV2_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectV2" ADD CONSTRAINT "ProjectV2_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectV2" ADD CONSTRAINT "ProjectV2_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "TimelineRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimelineRevision" ADD CONSTRAINT "TimelineRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimelineRevision" ADD CONSTRAINT "TimelineRevision_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimelineTrack" ADD CONSTRAINT "TimelineTrack_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimelineTrack" ADD CONSTRAINT "TimelineTrack_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "TimelineRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "TimelineTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Effect" ADD CONSTRAINT "Effect_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Keyframe" ADD CONSTRAINT "Keyframe_effectId_fkey" FOREIGN KEY ("effectId") REFERENCES "Effect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MediaArtifact" ADD CONSTRAINT "MediaArtifact_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IngestionSourceLink" ADD CONSTRAINT "IngestionSourceLink_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IngestionSourceLink" ADD CONSTRAINT "IngestionSourceLink_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranscriptWord" ADD CONSTRAINT "TranscriptWord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaptionStylePreset" ADD CONSTRAINT "CaptionStylePreset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaptionSegment" ADD CONSTRAINT "CaptionSegment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaptionSegment" ADD CONSTRAINT "CaptionSegment_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "TimelineTrack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CaptionSegment" ADD CONSTRAINT "CaptionSegment_stylePresetId_fkey" FOREIGN KEY ("stylePresetId") REFERENCES "CaptionStylePreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIProviderRun" ADD CONSTRAINT "AIProviderRun_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AIJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIOperationResult" ADD CONSTRAINT "AIOperationResult_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AIJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoiceProfile" ADD CONSTRAINT "VoiceProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceClone" ADD CONSTRAINT "VoiceClone_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceClone" ADD CONSTRAINT "VoiceClone_voiceProfileId_fkey" FOREIGN KEY ("voiceProfileId") REFERENCES "VoiceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AvatarProfile" ADD CONSTRAINT "AvatarProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AITwin" ADD CONSTRAINT "AITwin_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AITwin" ADD CONSTRAINT "AITwin_avatarProfileId_fkey" FOREIGN KEY ("avatarProfileId") REFERENCES "AvatarProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AITwin" ADD CONSTRAINT "AITwin_voiceProfileId_fkey" FOREIGN KEY ("voiceProfileId") REFERENCES "VoiceProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RightsAttestation" ADD CONSTRAINT "RightsAttestation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RightsAttestation" ADD CONSTRAINT "RightsAttestation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentVerification" ADD CONSTRAINT "ConsentVerification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentVerification" ADD CONSTRAINT "ConsentVerification_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VoiceClone" ADD CONSTRAINT "VoiceClone_consentVerificationId_fkey" FOREIGN KEY ("consentVerificationId") REFERENCES "ConsentVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AvatarProfile" ADD CONSTRAINT "AvatarProfile_consentVerificationId_fkey" FOREIGN KEY ("consentVerificationId") REFERENCES "ConsentVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AITwin" ADD CONSTRAINT "AITwin_consentVerificationId_fkey" FOREIGN KEY ("consentVerificationId") REFERENCES "ConsentVerification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrustEvent" ADD CONSTRAINT "TrustEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrustEvent" ADD CONSTRAINT "TrustEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PublicApiKey" ADD CONSTRAINT "PublicApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicApiKey" ADD CONSTRAINT "PublicApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
