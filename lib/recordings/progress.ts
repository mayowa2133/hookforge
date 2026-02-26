export type RecordingChunkProgressEntry = {
  partNumber: number;
};

export function summarizeRecordingProgress(totalParts: number, chunks: RecordingChunkProgressEntry[]) {
  const uploadedPartNumbers = [...new Set(chunks.map((chunk) => chunk.partNumber))].sort((a, b) => a - b);
  const completedParts = Math.min(totalParts, uploadedPartNumbers.length);
  const remainingParts = Math.max(0, totalParts - completedParts);
  const missingPartNumbers: number[] = [];
  for (let part = 1; part <= totalParts; part += 1) {
    if (!uploadedPartNumbers.includes(part)) {
      missingPartNumbers.push(part);
    }
  }
  const progressPct = totalParts === 0 ? 100 : Math.round((completedParts / totalParts) * 100);
  return {
    totalParts,
    completedParts,
    remainingParts,
    missingPartNumbers,
    uploadedPartNumbers,
    progressPct
  };
}
