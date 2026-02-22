-- Slice 2 transcript engine (additive)
ALTER TABLE "TranscriptWord" ADD COLUMN "segmentId" TEXT;

CREATE TABLE "TranscriptSegment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "speakerLabel" TEXT,
  "confidenceAvg" DOUBLE PRECISION,
  "source" TEXT NOT NULL DEFAULT 'ASR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TranscriptWord_segmentId_idx" ON "TranscriptWord"("segmentId");
CREATE INDEX "TranscriptSegment_projectId_language_startMs_idx" ON "TranscriptSegment"("projectId", "language", "startMs");

ALTER TABLE "TranscriptSegment"
  ADD CONSTRAINT "TranscriptSegment_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "ProjectV2"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TranscriptWord"
  ADD CONSTRAINT "TranscriptWord_segmentId_fkey"
  FOREIGN KEY ("segmentId") REFERENCES "TranscriptSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
