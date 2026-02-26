"use client";

import type {
  TimelineOperation as SharedTimelineOperation,
  TimelineSelectionState as SharedTimelineSelectionState
} from "@/lib/timeline-types";

export type ApiErrorPayload = {
  error?: string;
};

export type ProjectV2ApiPayload = {
  project: {
    id: string;
    title: string;
    status: string;
    creationMode?: "FREEFORM" | "QUICK_START";
    legacyProjectId: string | null;
    hasLegacyBridge?: boolean;
    supportsChatPlanApply?: boolean;
    supportsFreeformRender?: boolean;
    editorShell?: "LEGACY" | "OPENCUT";
    entrypointPath: string;
    legacyProject?: {
      id: string;
      title: string;
      status: string;
      template?: { id: string; slug: string; name: string } | null;
    } | null;
  };
};

export type LegacyProjectPayload = {
  project: {
    id: string;
    title: string;
    status: string;
    template: {
      id: string;
      slug: string;
      name: string;
      slotSchema: {
        slots: Array<{
          key: string;
          label: string;
          kinds: Array<"VIDEO" | "IMAGE" | "AUDIO">;
          required: boolean;
          minDurationSec?: number;
          helpText?: string;
        }>;
      };
    };
    assets: Array<{
      id: string;
      slotKey: string;
      kind: "VIDEO" | "IMAGE" | "AUDIO";
      signedUrl: string;
      durationSec: number | null;
      mimeType: string;
    }>;
    renderJobs: Array<{
      id: string;
      status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
      progress: number;
      outputUrl: string | null;
    }>;
  };
};

export type TimelinePayload = {
  timeline: {
    tracks: Array<{
      id: string;
      kind: "VIDEO" | "AUDIO" | "CAPTION";
      name: string;
      order: number;
      muted: boolean;
      volume: number;
      clips: Array<{
        id: string;
        assetId?: string;
        slotKey?: string;
        label?: string;
        timelineInMs: number;
        timelineOutMs: number;
        sourceInMs?: number;
        sourceOutMs?: number;
      }>;
    }>;
  };
  revisionId: string | null;
  revision: number;
};

export type TimelineSelectionState = SharedTimelineSelectionState;

export type TranscriptRangeSelection = {
  startWordIndex: number;
  endWordIndex: number;
};

export type TranscriptIssue = {
  id: string;
  type: "LOW_CONFIDENCE" | "OVERLAP" | "TIMING_DRIFT";
  severity: "INFO" | "WARN" | "ERROR";
  segmentId: string;
  startMs: number;
  endMs: number;
  message: string;
  confidenceAvg: number | null;
  speakerLabel: string | null;
};

export type TimelineOperation = SharedTimelineOperation;

export type TranscriptPayload = {
  projectId: string;
  projectV2Id: string;
  language: string;
  segments: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
    speakerLabel: string | null;
    confidenceAvg: number | null;
  }>;
  words: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
    confidence: number | null;
  }>;
  qualitySummary: {
    wordCount: number;
    segmentCount: number;
    averageConfidence: number;
  };
};

export type TranscriptPatchOperation =
  | { op: "replace_text"; segmentId: string; text: string }
  | { op: "split_segment"; segmentId: string; splitMs: number }
  | { op: "merge_segments"; firstSegmentId: string; secondSegmentId: string }
  | { op: "delete_range"; startMs: number; endMs: number }
  | { op: "set_speaker"; segmentId: string; speakerLabel: string | null }
  | { op: "normalize_punctuation"; segmentIds?: string[] };

type TranscriptPatchRequest = {
  language: string;
  operations: TranscriptPatchOperation[];
  minConfidenceForRipple?: number;
  previewOnly?: boolean;
};

type TranscriptRangeOpRequest = {
  language: string;
  selection: TranscriptRangeSelection;
  minConfidenceForRipple?: number;
};

type TranscriptSpeakerBatchRequest = {
  language: string;
  speakerLabel: string | null;
  fromSpeakerLabel?: string;
  segmentIds?: string[];
  maxConfidence?: number;
  minConfidenceForRipple?: number;
};

type TranscriptAutoRequest = {
  language: string;
  diarization: boolean;
  punctuationStyle: "auto" | "minimal" | "full";
  confidenceThreshold: number;
  reDecodeEnabled: boolean;
  maxWordsPerSegment: number;
  maxCharsPerLine: number;
  maxLinesPerSegment: number;
};

type ChatEditRequest = {
  prompt: string;
  attachmentAssetIds?: string[];
};

type ChatPlanRequest = {
  prompt: string;
  attachmentAssetIds?: string[];
};

type ChatApplyRequest = {
  planId: string;
  planRevisionHash: string;
  confirmed: true;
};

type ChatEditUndoRequest = {
  undoToken: string;
  force?: boolean;
};

type AssetPresignRequest = {
  slotKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type AssetRegisterRequest = {
  slotKey: string;
  storageKey: string;
  mimeType: string;
};

type MediaImportRequest = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  slot?: "primary" | "broll" | "audio";
};

type MediaRegisterRequest = {
  storageKey: string;
  mimeType: string;
  originalFileName?: string;
  slot?: "primary" | "broll" | "audio";
};

export type RecordingMode = "SCREEN" | "CAMERA" | "MIC" | "SCREEN_CAMERA";

type RecordingSessionStartRequest = {
  mode: RecordingMode;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  totalParts: number;
  partSizeBytes?: number;
  autoTranscribe?: boolean;
  language?: string;
};

type RecordingSessionFinalizeRequest = {
  autoTranscribe?: boolean;
  language?: string;
};

type RecordingChunkRequest = {
  partNumber: number;
  eTag?: string;
  checksumSha256?: string;
};

export type AssetPresignResponse = {
  uploadUrl: string;
  storageKey: string;
  method: "PUT";
  headers: {
    "Content-Type": string;
  };
};

export type AssetRegisterResponse = {
  asset: {
    id: string;
    slotKey: string;
    kind: "VIDEO" | "IMAGE" | "AUDIO";
    signedUrl: string;
    durationSec: number | null;
    mimeType: string;
  };
  project: {
    id: string;
    status: "DRAFT" | "READY" | "RENDERING" | "DONE" | "ERROR";
  };
  missingSlotKeys: string[];
};

export type MediaImportResponse = {
  uploadUrl: string;
  storageKey: string;
  method: "PUT";
  headers: {
    "Content-Type": string;
  };
  assetIdDraft: string;
};

export type MediaRegisterResponse = {
  asset: {
    id: string;
    slotKey: string;
    kind: "VIDEO" | "IMAGE" | "AUDIO";
    signedUrl: string;
    durationSec: number | null;
    mimeType: string;
  };
  mediaAsset: {
    id: string;
    storageKey: string;
    kind: "VIDEO" | "IMAGE" | "AUDIO";
    mimeType: string;
    durationSec: number | null;
  };
  project: {
    id: string;
    status: "DRAFT" | "READY" | "RENDERING" | "DONE" | "ERROR";
  };
  missingSlotKeys: string[];
};

export type RecordingSessionStartResponse = {
  session: {
    id: string;
    projectId: string;
    mode: RecordingMode;
    language: string;
    autoTranscribe: boolean;
    storageKey: string;
    totalParts: number;
    partSizeBytes: number;
    minPartSizeBytes: number;
    recommendedPartSizeBytes: number;
    status: "ACTIVE" | "FINALIZING" | "COMPLETED" | "CANCELED" | "FAILED";
  };
  next: {
    chunkEndpoint: string;
    statusEndpoint: string;
    finalizeEndpoint: string;
    cancelEndpoint: string;
  };
};

export type RecordingSessionStatusResponse = {
  session: {
    id: string;
    mode: RecordingMode;
    status: "ACTIVE" | "FINALIZING" | "COMPLETED" | "CANCELED" | "FAILED";
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    totalParts: number;
    partSizeBytes: number;
    autoTranscribe: boolean;
    language: string;
    finalizedAssetId: string | null;
    finalizeAiJobId: string | null;
    failedReason: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
  };
  progress: {
    totalParts: number;
    completedParts: number;
    remainingParts: number;
    missingPartNumbers: number[];
    uploadedPartNumbers: number[];
    progressPct: number;
  };
  chunks: Array<{
    partNumber: number;
    eTag: string;
    checksumSha256: string | null;
    uploadedAt: string;
  }>;
};

export type RecordingChunkResponse =
  | {
      mode: "UPLOAD_URL";
      partNumber: number;
      uploadUrl: string;
      method: "PUT";
    }
  | {
      mode: "CHUNK_CONFIRMED";
      partNumber: number;
      progress: {
        totalParts: number;
        completedParts: number;
        remainingParts: number;
        missingPartNumbers: number[];
        uploadedPartNumbers: number[];
        progressPct: number;
      };
    };

export type RecordingSessionFinalizeResponse = {
  finalized: boolean;
  status: "ACTIVE" | "FINALIZING" | "COMPLETED" | "CANCELED" | "FAILED";
  recordingSessionId?: string;
  finalizedAssetId?: string | null;
  aiJobId?: string | null;
  media?: MediaRegisterResponse;
};

export type ChatEditResponse = {
  executionMode: "APPLIED" | "SUGGESTIONS_ONLY";
  plannedOperations: Array<{
    op: string;
    trackId?: string;
    clipId?: string;
    [key: string]: unknown;
  }>;
  validatedOperations: Array<{
    op: string;
    trackId?: string;
    clipId?: string;
    [key: string]: unknown;
  }>;
  appliedTimelineOperations: Array<{
    op: string;
    trackId?: string;
    clipId?: string;
    [key: string]: unknown;
  }>;
  planValidation: {
    valid: boolean;
    reason?: string;
    confidence: number;
  };
  constrainedSuggestions: Array<{
    id: string;
    title: string;
    prompt: string;
    reason: string;
  }>;
  fallbackReason?: string;
  invariantIssues: Array<{
    code: string;
    message: string;
    severity: "INFO" | "WARN" | "ERROR";
  }>;
  appliedRevisionId: string | null;
  undoToken: string | null;
  aiJobId: string;
};

export type ChatEditUndoResponse = {
  restored: boolean;
  appliedRevisionId: string;
};

export type ChatPlanDiffGroup = {
  group: "timeline" | "transcript" | "captions";
  title: string;
  summary: string;
  items: Array<{
    id: string;
    type: "operation" | "note";
    label: string;
    before?: string;
    after?: string;
    severity?: "INFO" | "WARN" | "ERROR";
  }>;
};

export type ChatPlanResponse = {
  planId: string;
  planRevisionHash: string | null;
  confidence: number;
  requiresConfirmation: true;
  executionMode: "APPLIED" | "SUGGESTIONS_ONLY";
  opsPreview: Array<{
    op: string;
    [key: string]: unknown;
  }>;
  diffGroups: ChatPlanDiffGroup[];
  constrainedSuggestions: Array<{
    id: string;
    title: string;
    prompt: string;
    reason: string;
  }>;
  issues: Array<{
    code: string;
    message: string;
    severity: "INFO" | "WARN" | "ERROR";
  }>;
};

export type ChatApplyResponse = {
  applied: boolean;
  suggestionsOnly: boolean;
  issues: Array<{
    code: string;
    message: string;
    severity: "INFO" | "WARN" | "ERROR";
  }>;
  revisionId: string | null;
  undoToken: string | null;
};

export type EditorStatePayload = {
  project: {
    id: string;
    title: string;
    status: string;
    creationMode: "FREEFORM" | "QUICK_START";
    hasLegacyBridge: boolean;
    legacyProjectId: string;
  };
  assets: LegacyProjectPayload["project"]["assets"];
  mediaAssets: Array<{
    id: string;
    storageKey: string;
    mimeType: string;
    durationSec: number | null;
    createdAt: string;
  }>;
  timeline: TimelinePayload;
  transcript: TranscriptPayload | null;
};

export type TranscriptSearchPayload = {
  projectId: string;
  projectV2Id: string;
  language: string;
  query: string;
  totalSegments: number;
  totalMatches: number;
  matches: Array<{
    segmentId: string;
    startMs: number;
    endMs: number;
    text: string;
    confidenceAvg: number | null;
    matchStart: number;
    matchEnd: number;
  }>;
  tookMs: number;
};

export type TranscriptRangesPayload = {
  projectId: string;
  projectV2Id: string;
  language: string;
  totalWords: number;
  totalRanges: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
  ranges: Array<{
    segmentId: string;
    startWordIndex: number;
    endWordIndex: number;
    startMs: number;
    endMs: number;
    text: string;
    speakerLabel: string | null;
    confidenceAvg: number | null;
  }>;
};

export type TranscriptOperationResult = {
  applied: boolean;
  suggestionsOnly: boolean;
  revisionId: string | null;
  issues: Array<{ code: string; message: string; severity: "INFO" | "WARN" | "ERROR" }>;
  timelineOps: Array<{ op: string; [key: string]: unknown }>;
};

export type TranscriptRangeOperationPayload = TranscriptOperationResult & {
  mode: "PREVIEW" | "APPLY";
  selection: {
    startWordIndex: number;
    endWordIndex: number;
    startMs: number;
    endMs: number;
    wordCount: number;
    textPreview: string;
  };
};

export type TranscriptSpeakerBatchPayload = TranscriptOperationResult & {
  affectedSegments: number;
};

export type TranscriptIssuesPayload = {
  projectId: string;
  projectV2Id: string;
  language: string;
  minConfidence: number;
  totalIssues: number;
  byType: {
    LOW_CONFIDENCE: number;
    OVERLAP: number;
    TIMING_DRIFT: number;
  };
  issues: TranscriptIssue[];
};

export type EditorHealthStatus = {
  projectId: string;
  legacyProjectId: string;
  status: "HEALTHY" | "DEGRADED" | "WAITING_MEDIA" | "ERROR";
  syncStatus: "IN_SYNC" | "DRIFT";
  hasRenderableMedia: boolean;
  queue: {
    healthy: boolean;
    queues: Array<{
      name: string;
      counts: {
        waiting?: number;
        active?: number;
        completed?: number;
        failed?: number;
        delayed?: number;
      };
      backlog: number;
      healthy: boolean;
    }>;
  };
  render: {
    readiness: "READY" | "BLOCKED";
    latest: {
      id: string;
      status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
      progress: number;
      errorMessage: string | null;
      createdAt: string;
      updatedAt: string;
    } | null;
    recent: Array<{
      id: string;
      status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
      progress: number;
      errorMessage: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  ai: {
    latest: {
      id: string;
      type: string;
      status: "QUEUED" | "RUNNING" | "DONE" | "ERROR" | "CANCELED";
      progress: number;
      errorMessage: string | null;
      createdAt: string;
      updatedAt: string;
    } | null;
    recent: Array<{
      id: string;
      type: string;
      status: "QUEUED" | "RUNNING" | "DONE" | "ERROR" | "CANCELED";
      progress: number;
      errorMessage: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  updatedAt: string;
};

export type PresetCatalogResponse = {
  presets: Array<{
    id: string;
    slug: string;
    name: string;
    description: string;
    tags: string[];
  }>;
};

type OpenCutTelemetryRequest = {
  projectId: string;
  event: "editor_open" | "transcript_edit_apply" | "chat_edit_apply" | "render_start" | "render_done" | "render_error";
  outcome?: "SUCCESS" | "ERROR" | "INFO";
  metadata?: Record<string, unknown>;
};

export type OpenCutMetricsResponse = {
  windowHours: number;
  totalEvents: number;
  generatedAt: string;
  metrics: Array<{
    event: "editor_open" | "transcript_edit_apply" | "chat_edit_apply" | "render_start" | "render_done" | "render_error";
    total: number;
    success: number;
    error: number;
    info: number;
    successRate: number | null;
  }>;
};

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }
  return payload;
}

export async function getProjectV2(projectV2Id: string) {
  return requestJson<ProjectV2ApiPayload>(`/api/projects-v2/${projectV2Id}`);
}

export async function getLegacyProject(projectIdOrV2Id: string) {
  return requestJson<LegacyProjectPayload>(`/api/projects/${projectIdOrV2Id}`);
}

export async function getTimeline(projectIdOrV2Id: string) {
  return requestJson<TimelinePayload>(`/api/projects-v2/${projectIdOrV2Id}/timeline`);
}

export async function patchTimeline(projectIdOrV2Id: string, operations: TimelineOperation[]) {
  return requestJson<TimelinePayload>(`/api/projects-v2/${projectIdOrV2Id}/timeline`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operations })
  });
}

export async function getTranscript(projectV2Id: string, language: string) {
  return requestJson<TranscriptPayload>(`/api/projects-v2/${projectV2Id}/transcript?language=${encodeURIComponent(language)}`);
}

export async function searchTranscript(projectV2Id: string, language: string, q: string) {
  return requestJson<TranscriptSearchPayload>(
    `/api/projects-v2/${projectV2Id}/transcript/search?language=${encodeURIComponent(language)}&q=${encodeURIComponent(q)}`
  );
}

export async function getTranscriptRanges(projectV2Id: string, language: string, offset = 0, limit = 200) {
  return requestJson<TranscriptRangesPayload>(
    `/api/projects-v2/${projectV2Id}/transcript/ranges?language=${encodeURIComponent(language)}&offset=${offset}&limit=${limit}`
  );
}

export async function getTranscriptIssues(projectV2Id: string, language: string, minConfidence = 0.86, limit = 1200) {
  return requestJson<TranscriptIssuesPayload>(
    `/api/projects-v2/${projectV2Id}/transcript/issues?language=${encodeURIComponent(language)}&minConfidence=${minConfidence}&limit=${limit}`
  );
}

export async function autoTranscript(projectV2Id: string, body: TranscriptAutoRequest) {
  return requestJson<{ aiJobId: string; status: string; trackId: string }>(`/api/projects-v2/${projectV2Id}/transcript/auto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function patchTranscript(projectV2Id: string, body: TranscriptPatchRequest) {
  return requestJson<Omit<TranscriptOperationResult, "timelineOps"> & { timelineOps?: Array<{ op: string; [key: string]: unknown }> }>(
    `/api/projects-v2/${projectV2Id}/transcript`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}

export async function previewTranscriptRangeDelete(projectV2Id: string, body: TranscriptRangeOpRequest) {
  return requestJson<TranscriptRangeOperationPayload>(`/api/projects-v2/${projectV2Id}/transcript/ranges/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function applyTranscriptRangeDelete(projectV2Id: string, body: TranscriptRangeOpRequest) {
  return requestJson<TranscriptRangeOperationPayload>(`/api/projects-v2/${projectV2Id}/transcript/ranges/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function batchSetTranscriptSpeaker(projectV2Id: string, body: TranscriptSpeakerBatchRequest) {
  return requestJson<TranscriptSpeakerBatchPayload>(`/api/projects-v2/${projectV2Id}/transcript/speakers/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function previewTranscriptOps(projectV2Id: string, body: TranscriptPatchRequest) {
  return requestJson<TranscriptOperationResult & { mode: "PREVIEW" }>(`/api/projects-v2/${projectV2Id}/transcript/ops/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function applyTranscriptOps(projectV2Id: string, body: TranscriptPatchRequest) {
  return requestJson<TranscriptOperationResult & { mode: "APPLY" }>(`/api/projects-v2/${projectV2Id}/transcript/ops/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function presignProjectAsset(projectIdOrV2Id: string, body: AssetPresignRequest) {
  return requestJson<AssetPresignResponse>(`/api/projects/${projectIdOrV2Id}/assets/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function registerProjectAsset(projectIdOrV2Id: string, body: AssetRegisterRequest) {
  return requestJson<AssetRegisterResponse>(`/api/projects/${projectIdOrV2Id}/assets/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function importProjectV2Media(projectIdOrV2Id: string, body: MediaImportRequest) {
  return requestJson<MediaImportResponse>(`/api/projects-v2/${projectIdOrV2Id}/media/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function registerProjectV2Media(projectIdOrV2Id: string, body: MediaRegisterRequest) {
  return requestJson<MediaRegisterResponse>(`/api/projects-v2/${projectIdOrV2Id}/media/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function startProjectV2RecordingSession(projectIdOrV2Id: string, body: RecordingSessionStartRequest) {
  return requestJson<RecordingSessionStartResponse>(`/api/projects-v2/${projectIdOrV2Id}/recordings/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2RecordingSession(projectIdOrV2Id: string, sessionId: string) {
  return requestJson<RecordingSessionStatusResponse>(`/api/projects-v2/${projectIdOrV2Id}/recordings/session/${sessionId}`);
}

export async function postProjectV2RecordingChunk(projectIdOrV2Id: string, sessionId: string, body: RecordingChunkRequest) {
  return requestJson<RecordingChunkResponse>(`/api/projects-v2/${projectIdOrV2Id}/recordings/session/${sessionId}/chunk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function finalizeProjectV2RecordingSession(
  projectIdOrV2Id: string,
  sessionId: string,
  body: RecordingSessionFinalizeRequest = {}
) {
  return requestJson<RecordingSessionFinalizeResponse>(
    `/api/projects-v2/${projectIdOrV2Id}/recordings/session/${sessionId}/finalize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}

export async function cancelProjectV2RecordingSession(projectIdOrV2Id: string, sessionId: string) {
  return requestJson<{ canceled: boolean; status: "ACTIVE" | "FINALIZING" | "COMPLETED" | "CANCELED" | "FAILED" }>(
    `/api/projects-v2/${projectIdOrV2Id}/recordings/session/${sessionId}/cancel`,
    {
      method: "POST"
    }
  );
}

export async function runChatEdit(projectIdOrV2Id: string, body: ChatEditRequest) {
  return requestJson<ChatEditResponse>(`/api/projects/${projectIdOrV2Id}/chat-edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function undoChatEdit(projectIdOrV2Id: string, body: ChatEditUndoRequest) {
  return requestJson<ChatEditUndoResponse>(`/api/projects/${projectIdOrV2Id}/chat-edit/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function planProjectV2ChatEdit(projectIdOrV2Id: string, body: ChatPlanRequest) {
  return requestJson<ChatPlanResponse>(`/api/projects-v2/${projectIdOrV2Id}/chat/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function applyProjectV2ChatEdit(projectIdOrV2Id: string, body: ChatApplyRequest) {
  return requestJson<ChatApplyResponse>(`/api/projects-v2/${projectIdOrV2Id}/chat/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function undoProjectV2ChatEdit(projectIdOrV2Id: string, body: ChatEditUndoRequest) {
  return requestJson<ChatEditUndoResponse>(`/api/projects-v2/${projectIdOrV2Id}/chat/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2EditorState(projectIdOrV2Id: string) {
  return requestJson<EditorStatePayload>(`/api/projects-v2/${projectIdOrV2Id}/editor-state`);
}

export async function getProjectV2EditorHealth(projectIdOrV2Id: string) {
  return requestJson<EditorHealthStatus>(`/api/projects-v2/${projectIdOrV2Id}/editor-health`);
}

export async function getProjectV2Presets() {
  return requestJson<PresetCatalogResponse>(`/api/projects-v2/presets`);
}

export async function applyProjectV2Preset(projectIdOrV2Id: string, presetId: string) {
  return requestJson<{ applied: boolean; presetId: string; operationCount?: number; reason?: string; revisionId: string | null }>(
    `/api/projects-v2/${projectIdOrV2Id}/presets/apply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId })
    }
  );
}

export async function trackOpenCutTelemetry(body: OpenCutTelemetryRequest) {
  return requestJson<{ tracked: boolean; eventId: string; createdAt: string }>(`/api/opencut/telemetry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getOpenCutMetrics(windowHours = 24) {
  return requestJson<OpenCutMetricsResponse>(`/api/opencut/metrics?windowHours=${windowHours}`);
}

export async function startRender(projectIdOrV2Id: string) {
  return requestJson<{ renderJob: { id: string; status: string; progress: number } }>(`/api/projects-v2/${projectIdOrV2Id}/render/final`, {
    method: "POST"
  });
}

export async function getRenderJob(renderJobId: string) {
  return requestJson<{
    renderJob: {
      id: string;
      status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
      progress: number;
      outputUrl: string | null;
      errorMessage: string | null;
    };
  }>(`/api/render-jobs/${renderJobId}`);
}

export async function getAiJob(aiJobId: string) {
  return requestJson<{
    aiJob: {
      id: string;
      status: "QUEUED" | "RUNNING" | "DONE" | "ERROR" | "CANCELED";
      progress: number;
      errorMessage?: string | null;
    };
  }>(`/api/ai-jobs/${aiJobId}?includeTrace=false`);
}
