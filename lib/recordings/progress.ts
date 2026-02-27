export type RecordingChunkProgressEntry = {
  partNumber: number;
  eTag?: string;
  checksumSha256?: string | null;
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

type RecordingRange = {
  startPart: number;
  endPart: number;
};

type RecordingRecoveryConflict = {
  code: "MISSING_PARTS" | "DUPLICATE_PART_NUMBER" | "CHECKSUM_MISMATCH";
  severity: "WARN" | "FAIL";
  message: string;
  partNumbers: number[];
};

export function buildDeterministicRecordingRecoveryPlan(params: {
  totalParts: number;
  chunks: RecordingChunkProgressEntry[];
}) {
  const progress = summarizeRecordingProgress(params.totalParts, params.chunks);
  const chunkByPart = new Map<number, RecordingChunkProgressEntry[]>();
  for (const chunk of params.chunks) {
    const list = chunkByPart.get(chunk.partNumber) ?? [];
    list.push(chunk);
    chunkByPart.set(chunk.partNumber, list);
  }

  const ranges: RecordingRange[] = [];
  let rangeStart: number | null = null;
  let previous: number | null = null;
  for (const part of progress.uploadedPartNumbers) {
    if (rangeStart === null) {
      rangeStart = part;
      previous = part;
      continue;
    }
    if (previous !== null && part === previous + 1) {
      previous = part;
      continue;
    }
    ranges.push({
      startPart: rangeStart,
      endPart: previous ?? rangeStart
    });
    rangeStart = part;
    previous = part;
  }
  if (rangeStart !== null) {
    ranges.push({
      startPart: rangeStart,
      endPart: previous ?? rangeStart
    });
  }

  const conflicts: RecordingRecoveryConflict[] = [];
  if (progress.missingPartNumbers.length > 0) {
    conflicts.push({
      code: "MISSING_PARTS",
      severity: "WARN",
      message: `${progress.missingPartNumbers.length} part(s) are still missing.`,
      partNumbers: progress.missingPartNumbers
    });
  }

  for (const [partNumber, entries] of chunkByPart) {
    if (entries.length > 1) {
      conflicts.push({
        code: "DUPLICATE_PART_NUMBER",
        severity: "WARN",
        message: `Part ${partNumber} was uploaded more than once.`,
        partNumbers: [partNumber]
      });
      const checksums = [...new Set(entries.map((entry) => entry.checksumSha256).filter((value): value is string => Boolean(value)))];
      if (checksums.length > 1) {
        conflicts.push({
          code: "CHECKSUM_MISMATCH",
          severity: "FAIL",
          message: `Part ${partNumber} has mismatched checksums across retries.`,
          partNumbers: [partNumber]
        });
      }
    }
  }

  const repairActions = [
    progress.missingPartNumbers.length > 0
      ? `Resume upload for missing parts: ${progress.missingPartNumbers.join(", ")}.`
      : "No missing parts detected.",
    conflicts.some((conflict) => conflict.code === "CHECKSUM_MISMATCH")
      ? "Re-upload checksum-mismatched parts before finalize."
      : "Checksum consistency looks good for uploaded parts.",
    "Finalize only when all parts are present and conflicts are resolved."
  ];

  const failurePenalty = conflicts.reduce((sum, conflict) => sum + (conflict.severity === "FAIL" ? 20 : 8), 0);
  const recoverySuccessScore = Math.max(1, Math.min(99, progress.progressPct - failurePenalty + (progress.remainingParts === 0 ? 10 : 0)));
  const expectedRecoveryState = conflicts.some((conflict) => conflict.severity === "FAIL")
    ? "REQUIRES_REPAIR"
    : progress.remainingParts > 0
      ? "READY_TO_RESUME"
      : "READY_TO_FINALIZE";

  return {
    progress,
    ranges,
    conflicts,
    repairActions,
    recoverySuccessScore,
    expectedRecoveryState
  };
}
