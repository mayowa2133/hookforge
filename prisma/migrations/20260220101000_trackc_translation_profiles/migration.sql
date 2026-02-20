CREATE TABLE "TranslationProfile" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sourceLanguage" TEXT NOT NULL,
  "tone" TEXT NOT NULL,
  "glossary" JSONB NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TranslationProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TranslationProfile_workspaceId_name_key" ON "TranslationProfile"("workspaceId", "name");
CREATE INDEX "TranslationProfile_workspaceId_sourceLanguage_isDefault_idx" ON "TranslationProfile"("workspaceId", "sourceLanguage", "isDefault");

ALTER TABLE "TranslationProfile"
  ADD CONSTRAINT "TranslationProfile_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
