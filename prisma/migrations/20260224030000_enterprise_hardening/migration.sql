-- Post-Phase 6 enterprise hardening (additive)

CREATE TYPE "IdentityProviderType" AS ENUM ('OIDC', 'SAML');
CREATE TYPE "SsoSessionStatus" AS ENUM ('INITIATED', 'COMPLETED', 'EXPIRED', 'FAILED');

ALTER TABLE "PublicApiKey"
  ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "rotatedFromKeyId" TEXT,
  ADD COLUMN "lastRotationAt" TIMESTAMP(3);

CREATE TABLE "WorkspaceSecurityPolicy" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "enforceSso" BOOLEAN NOT NULL DEFAULT false,
  "allowPasswordAuth" BOOLEAN NOT NULL DEFAULT true,
  "sessionTtlHours" INTEGER NOT NULL DEFAULT 168,
  "requireMfa" BOOLEAN NOT NULL DEFAULT false,
  "allowedEmailDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "canaryAllowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceSecurityPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceSecurityPolicy_workspaceId_key" ON "WorkspaceSecurityPolicy"("workspaceId");

CREATE TABLE "IdentityProviderConfig" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "type" "IdentityProviderType" NOT NULL,
  "name" TEXT NOT NULL,
  "issuerUrl" TEXT,
  "clientId" TEXT,
  "clientSecretCiphertext" TEXT,
  "authorizationEndpoint" TEXT,
  "tokenEndpoint" TEXT,
  "jwksUri" TEXT,
  "samlMetadataXml" TEXT,
  "samlEntityId" TEXT,
  "samlSsoUrl" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdentityProviderConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityProviderConfig_workspaceId_name_key" ON "IdentityProviderConfig"("workspaceId", "name");
CREATE INDEX "IdentityProviderConfig_workspaceId_type_idx" ON "IdentityProviderConfig"("workspaceId", "type");

CREATE TABLE "UserIdentity" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "providerType" "IdentityProviderType" NOT NULL,
  "providerSubject" TEXT NOT NULL,
  "email" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserIdentity_providerId_providerSubject_key" ON "UserIdentity"("providerId", "providerSubject");
CREATE INDEX "UserIdentity_workspaceId_userId_idx" ON "UserIdentity"("workspaceId", "userId");

CREATE TABLE "SsoSession" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" TEXT,
  "state" TEXT NOT NULL,
  "nonce" TEXT,
  "returnTo" TEXT,
  "codeVerifier" TEXT,
  "status" "SsoSessionStatus" NOT NULL DEFAULT 'INITIATED',
  "errorMessage" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "SsoSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SsoSession_state_key" ON "SsoSession"("state");
CREATE INDEX "SsoSession_workspaceId_status_createdAt_idx" ON "SsoSession"("workspaceId", "status", "createdAt");
CREATE INDEX "SsoSession_providerId_idx" ON "SsoSession"("providerId");

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "severity" "TrustSeverity" NOT NULL DEFAULT 'INFO',
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");
CREATE INDEX "AuditEvent_workspaceId_action_createdAt_idx" ON "AuditEvent"("workspaceId", "action", "createdAt");

CREATE TABLE "SystemIncident" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "category" TEXT NOT NULL,
  "severity" "TrustSeverity" NOT NULL DEFAULT 'WARN',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "summary" TEXT NOT NULL,
  "metadata" JSONB,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemIncident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemIncident_status_severity_createdAt_idx" ON "SystemIncident"("status", "severity", "createdAt");
CREATE INDEX "SystemIncident_workspaceId_createdAt_idx" ON "SystemIncident"("workspaceId", "createdAt");

ALTER TABLE "PublicApiKey"
  ADD CONSTRAINT "PublicApiKey_rotatedFromKeyId_fkey"
  FOREIGN KEY ("rotatedFromKeyId") REFERENCES "PublicApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PublicApiKey_status_expiresAt_idx" ON "PublicApiKey"("status", "expiresAt");

ALTER TABLE "WorkspaceSecurityPolicy"
  ADD CONSTRAINT "WorkspaceSecurityPolicy_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceSecurityPolicy"
  ADD CONSTRAINT "WorkspaceSecurityPolicy_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IdentityProviderConfig"
  ADD CONSTRAINT "IdentityProviderConfig_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdentityProviderConfig"
  ADD CONSTRAINT "IdentityProviderConfig_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserIdentity"
  ADD CONSTRAINT "UserIdentity_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserIdentity"
  ADD CONSTRAINT "UserIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserIdentity"
  ADD CONSTRAINT "UserIdentity_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "IdentityProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SsoSession"
  ADD CONSTRAINT "SsoSession_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SsoSession"
  ADD CONSTRAINT "SsoSession_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "IdentityProviderConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SsoSession"
  ADD CONSTRAINT "SsoSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SystemIncident"
  ADD CONSTRAINT "SystemIncident_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SystemIncident"
  ADD CONSTRAINT "SystemIncident_resolvedByUserId_fkey"
  FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "WorkspaceSecurityPolicy" (
  "id",
  "workspaceId",
  "enforceSso",
  "allowPasswordAuth",
  "sessionTtlHours",
  "requireMfa",
  "allowedEmailDomains",
  "canaryAllowlist",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('wsp_', REPLACE("id", '-', '')),
  "id",
  false,
  true,
  168,
  false,
  ARRAY[]::TEXT[],
  ARRAY[]::TEXT[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Workspace"
ON CONFLICT ("workspaceId") DO NOTHING;
