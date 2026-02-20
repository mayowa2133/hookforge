-- Enums
CREATE TYPE "ModelVersionStatus" AS ENUM ('CANDIDATE', 'ACTIVE', 'DEPRECATED', 'ROLLED_BACK');
CREATE TYPE "EvalRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');
CREATE TYPE "UsageAnomalySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "UsageAnomalyStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- Tables
CREATE TABLE "ModelVersion" (
  "id" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" "ModelVersionStatus" NOT NULL DEFAULT 'CANDIDATE',
  "qualityScore" DOUBLE PRECISION,
  "latencyP95Ms" INTEGER,
  "successRate" DOUBLE PRECISION,
  "costPerMinUsd" DECIMAL(10,4),
  "releasedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoutingPolicy" (
  "id" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "activeModelVersionId" TEXT,
  "fallbackModelVersionId" TEXT,
  "rolloutPercent" INTEGER NOT NULL DEFAULT 100,
  "maxP95LatencyMs" INTEGER,
  "minSuccessRate" DOUBLE PRECISION,
  "enforceQualityGate" BOOLEAN NOT NULL DEFAULT true,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoutingPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QualityEvalRun" (
  "id" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "modelVersionId" TEXT,
  "status" "EvalRunStatus" NOT NULL DEFAULT 'QUEUED',
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "datasetRef" TEXT,
  "metrics" JSONB,
  "passed" BOOLEAN,
  "summary" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityEvalRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QualityFeedback" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT,
  "aiJobId" TEXT,
  "category" TEXT NOT NULL,
  "rating" INTEGER,
  "comment" TEXT,
  "metadata" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualityFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsageAnomaly" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "severity" "UsageAnomalySeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "UsageAnomalyStatus" NOT NULL DEFAULT 'OPEN',
  "expectedAmount" INTEGER,
  "actualAmount" INTEGER,
  "deviationPct" DOUBLE PRECISION,
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageAnomaly_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "ModelVersion_capability_provider_model_version_key" ON "ModelVersion"("capability", "provider", "model", "version");
CREATE INDEX "ModelVersion_capability_status_idx" ON "ModelVersion"("capability", "status");

CREATE UNIQUE INDEX "RoutingPolicy_capability_key" ON "RoutingPolicy"("capability");
CREATE INDEX "RoutingPolicy_activeModelVersionId_idx" ON "RoutingPolicy"("activeModelVersionId");
CREATE INDEX "RoutingPolicy_fallbackModelVersionId_idx" ON "RoutingPolicy"("fallbackModelVersionId");

CREATE INDEX "QualityEvalRun_capability_createdAt_idx" ON "QualityEvalRun"("capability", "createdAt");
CREATE INDEX "QualityEvalRun_status_createdAt_idx" ON "QualityEvalRun"("status", "createdAt");

CREATE INDEX "QualityFeedback_workspaceId_createdAt_idx" ON "QualityFeedback"("workspaceId", "createdAt");
CREATE INDEX "QualityFeedback_projectId_idx" ON "QualityFeedback"("projectId");
CREATE INDEX "QualityFeedback_aiJobId_idx" ON "QualityFeedback"("aiJobId");

CREATE INDEX "UsageAnomaly_workspaceId_status_createdAt_idx" ON "UsageAnomaly"("workspaceId", "status", "createdAt");
CREATE INDEX "UsageAnomaly_severity_createdAt_idx" ON "UsageAnomaly"("severity", "createdAt");

-- Foreign keys
ALTER TABLE "RoutingPolicy" ADD CONSTRAINT "RoutingPolicy_activeModelVersionId_fkey" FOREIGN KEY ("activeModelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoutingPolicy" ADD CONSTRAINT "RoutingPolicy_fallbackModelVersionId_fkey" FOREIGN KEY ("fallbackModelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoutingPolicy" ADD CONSTRAINT "RoutingPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QualityEvalRun" ADD CONSTRAINT "QualityEvalRun_modelVersionId_fkey" FOREIGN KEY ("modelVersionId") REFERENCES "ModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QualityEvalRun" ADD CONSTRAINT "QualityEvalRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QualityFeedback" ADD CONSTRAINT "QualityFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QualityFeedback" ADD CONSTRAINT "QualityFeedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QualityFeedback" ADD CONSTRAINT "QualityFeedback_aiJobId_fkey" FOREIGN KEY ("aiJobId") REFERENCES "AIJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QualityFeedback" ADD CONSTRAINT "QualityFeedback_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UsageAnomaly" ADD CONSTRAINT "UsageAnomaly_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageAnomaly" ADD CONSTRAINT "UsageAnomaly_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
