-- Descript+ Phase 5: workspace brand presets for collaboration/publishing defaults

CREATE TABLE "WorkspaceBrandPreset" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "name" TEXT NOT NULL DEFAULT 'Default Brand Preset',
  "captionStylePresetId" TEXT,
  "audioPreset" TEXT,
  "defaultConnector" TEXT NOT NULL DEFAULT 'package',
  "defaultVisibility" TEXT NOT NULL DEFAULT 'private',
  "defaultTitlePrefix" TEXT,
  "defaultTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceBrandPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceBrandPreset_workspaceId_key" ON "WorkspaceBrandPreset"("workspaceId");
CREATE INDEX "WorkspaceBrandPreset_workspaceId_updatedAt_idx" ON "WorkspaceBrandPreset"("workspaceId", "updatedAt");

ALTER TABLE "WorkspaceBrandPreset"
  ADD CONSTRAINT "WorkspaceBrandPreset_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceBrandPreset"
  ADD CONSTRAINT "WorkspaceBrandPreset_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WorkspaceBrandPreset"
  ADD CONSTRAINT "WorkspaceBrandPreset_captionStylePresetId_fkey"
  FOREIGN KEY ("captionStylePresetId") REFERENCES "CaptionStylePreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
