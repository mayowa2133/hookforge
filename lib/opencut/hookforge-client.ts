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

export type AudioEnhancementPreset = "clean_voice" | "dialogue_enhance" | "broadcast_loudness" | "custom";
export type AudioSafetyMode = "AUTO_APPLY" | "APPLY_WITH_CONFIRM" | "PREVIEW_ONLY";

export type AudioFillerCandidate = {
  id: string;
  segmentId: string | null;
  wordId: string | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  reason: "TOKEN" | "BIGRAM";
  wordIds: string[];
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

type TranscriptSearchReplaceRequest = {
  language?: string;
  search: string;
  replace: string;
  caseSensitive?: boolean;
  maxSegments?: number;
};

type TranscriptCheckpointCreateRequest = {
  language?: string;
  label?: string;
};

type AudioEnhanceRequest = {
  language?: string;
  preset: AudioEnhancementPreset;
  denoise?: boolean;
  clarity?: boolean;
  deEsser?: boolean;
  normalizeLoudness?: boolean;
  bypassEnhancement?: boolean;
  soloPreview?: boolean;
  confirmed?: boolean;
  targetLufs: number;
  intensity: number;
};

type AudioFillerRequest = {
  language?: string;
  candidateIds?: string[];
  maxCandidates?: number;
  maxConfidence?: number;
  confirmed?: boolean;
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
  operationDecisions?: ChatPlanOperationDecision[];
};

type ChatEditUndoRequest = {
  undoToken: string;
  force?: boolean;
  lineageMode?: "latest" | "force";
};

export type AutopilotPlannerPack = "timeline" | "transcript" | "captions" | "audio" | "publishing";
export type AutopilotMacroId =
  | "tighten_pacing"
  | "remove_filler_normalize_audio"
  | "social_cut_from_range"
  | "speaker_cleanup_chaptering";

export type AutopilotMacroArgs = {
  startMs?: number;
  endMs?: number;
  speakerLabel?: string;
  chapterCount?: number;
};

export type AutopilotDiffGroup = {
  group: "timeline" | "transcript" | "captions" | "audio" | "publishing";
  title: string;
  summary: string;
  items: Array<{
    id: string;
    type: "operation" | "note";
    label: string;
    before?: string;
    after?: string;
    severity?: "INFO" | "WARN" | "ERROR";
    operationIndex?: number;
  }>;
};

type AutopilotPlanRequest = {
  prompt?: string;
  plannerPack?: AutopilotPlannerPack;
  macroId?: AutopilotMacroId;
  macroArgs?: AutopilotMacroArgs;
  attachmentAssetIds?: string[];
};

type AutopilotApplyRequest = {
  sessionId: string;
  planRevisionHash: string;
  confirmed: true;
  operationDecisions?: ChatPlanOperationDecision[];
};

type AutopilotUndoRequest = {
  sessionId?: string;
  undoToken: string;
  force?: boolean;
};

type AutopilotReplayRequest = {
  sessionId: string;
  confirmed: true;
  applyImmediately?: boolean;
  reuseOperationDecisions?: boolean;
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

type CreateShareLinkRequest = {
  scope: "VIEW" | "COMMENT" | "APPROVE";
  expiresInDays?: number;
};

type CreateReviewCommentRequest = {
  shareToken?: string;
  body: string;
  anchorMs?: number | null;
  transcriptStartMs?: number | null;
  transcriptEndMs?: number | null;
  timelineTrackId?: string | null;
  clipId?: string | null;
};

type UpdateReviewCommentStatusRequest = {
  shareToken?: string;
  status: "OPEN" | "RESOLVED";
};

type SubmitReviewDecisionRequest = {
  shareToken?: string;
  status: "APPROVED" | "REJECTED";
  note?: string;
  requireApproval?: boolean;
};

type CreateReviewRequestRequest = {
  title: string;
  note?: string;
  requiredScopes?: Array<"VIEW" | "COMMENT" | "APPROVE" | "EDIT">;
  approvalChain?: Array<{
    id?: string;
    role: "OWNER" | "ADMIN" | "EDITOR";
    label?: string;
    required?: boolean;
    order?: number;
  }>;
};

type DecideReviewRequestRequest = {
  status: "APPROVED" | "REJECTED";
  note?: string;
  requireApproval?: boolean;
  approvalChainStepId?: string;
};

type RecordDescriptDiffRequest = {
  comparisonMonth: string;
  source?: string;
  notes?: string;
  discoveredFeatures?: Array<{
    title: string;
    changeType: "added" | "changed" | "removed";
    mappedFeatureId?: string;
    status?: "mapped" | "gap" | "deferred";
  }>;
  unresolvedDriftCount?: number;
};

type FreezeReleaseCandidateRequest = {
  releaseTag: string;
  notes?: string;
};

type UnfreezeReleaseCandidateRequest = {
  notes?: string;
};

type RecordPhase6PilotFeedbackRequest = {
  cohort: "dogfood" | "pilot";
  sessionId: string;
  workflowSuccessPct: number;
  blockerCount?: number;
  crashCount?: number;
  participantCount?: number;
  rating?: number;
  notes?: string;
};

type CreateExportProfileRequest = {
  name: string;
  container?: string;
  resolution?: string;
  fps?: number;
  videoBitrateKbps?: number | null;
  audioBitrateKbps?: number | null;
  audioPreset?: string | null;
  captionStylePresetId?: string | null;
  isDefault?: boolean;
  config?: Record<string, unknown>;
};

type ApplyExportProfileRequest = {
  profileId?: string;
  createProfile?: CreateExportProfileRequest;
};

type PublishConnectorExportRequest = {
  exportProfileId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: "private" | "unlisted" | "public";
  distributionPresetId?: string;
  distributionPreset?: {
    id?: string;
    name?: string;
    connector?: "youtube" | "drive" | "package" | "all";
    visibility?: "private" | "unlisted" | "public" | null;
    titleTemplate?: string | null;
    descriptionTemplate?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
    isDefault?: boolean;
  };
  metadataPackId?: string;
  metadataPack?: {
    id?: string;
    name?: string;
    connector?: "youtube" | "drive" | "package" | "all";
    metadata?: Record<string, unknown>;
    tags?: string[];
  };
  platformMetadata?: Record<string, unknown>;
};

type PublishConnectorBatchRequest = {
  connectors: Array<"youtube" | "drive" | "package">;
  baseInput?: PublishConnectorExportRequest;
  byConnector?: Partial<Record<"youtube" | "drive" | "package", PublishConnectorExportRequest>>;
};

type BrandPresetUpsertRequest = {
  name?: string;
  captionStylePresetId?: string | null;
  audioPreset?: string | null;
  defaultConnector?: "youtube" | "drive" | "package";
  defaultVisibility?: "private" | "unlisted" | "public";
  defaultTitlePrefix?: string | null;
  defaultTags?: string[];
  brandKit?: {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    fontFamily?: string;
    logoAssetId?: string;
    watermarkAssetId?: string;
  };
  customFonts?: Array<{
    id?: string;
    name: string;
    family?: string;
    weight?: number;
    style?: "normal" | "italic";
    format?: "ttf" | "otf" | "woff" | "woff2";
    assetId?: string;
    url?: string;
    isVariable?: boolean;
    fallback?: string;
  }>;
  layoutPacks?: Array<{
    id?: string;
    name: string;
    aspectRatio?: string;
    sceneLayoutIds?: string[];
    tags?: string[];
    isDefault?: boolean;
  }>;
  templatePacks?: Array<{
    id?: string;
    name: string;
    category?: string;
    layoutPackId?: string | null;
    captionStylePresetId?: string | null;
    audioPreset?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }>;
  distributionPresets?: Array<{
    id?: string;
    name: string;
    connector?: "youtube" | "drive" | "package" | "all";
    visibility?: "private" | "unlisted" | "public" | null;
    titleTemplate?: string | null;
    descriptionTemplate?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
    isDefault?: boolean;
  }>;
  metadataPacks?: Array<{
    id?: string;
    name: string;
    connector?: "youtube" | "drive" | "package" | "all";
    metadata?: Record<string, unknown>;
    tags?: string[];
  }>;
  metadata?: Record<string, unknown>;
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
    recoverEndpoint: string;
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

export type RecordingSessionRecoverResponse = {
  sessionId: string;
  recoverable: boolean;
  resumed: boolean;
  status: "ACTIVE" | "FINALIZING" | "COMPLETED" | "CANCELED" | "FAILED";
  progress: {
    totalParts: number;
    completedParts: number;
    remainingParts: number;
    missingPartNumbers: number[];
    uploadedPartNumbers: number[];
    progressPct: number;
  };
  state: {
    phase: "RESUMED" | "RECOVERABLE" | "TERMINAL" | "REPAIR_REQUIRED";
    failedReason: string | null;
  };
  recoveryPlan?: {
    ranges: Array<{ startPart: number; endPart: number }>;
    conflicts: Array<{
      code: "MISSING_PARTS" | "DUPLICATE_PART_NUMBER" | "CHECKSUM_MISMATCH";
      severity: "WARN" | "FAIL";
      message: string;
      partNumbers: number[];
    }>;
    repairActions: string[];
    recoverySuccessScore: number;
    expectedRecoveryState: "READY_TO_RESUME" | "READY_TO_FINALIZE" | "REQUIRES_REPAIR";
  };
  merge?: {
    ranges: Array<{ startPart: number; endPart: number }>;
    repairActions: string[];
    successScore: number;
  };
  reliability?: {
    recoverySuccessTargetPct: number;
    estimatedRecoverySuccessPct: number;
  };
};

export type StudioRoomSummary = {
  id: string;
  projectId: string;
  provider: string;
  roomName: string;
  status: "ACTIVE" | "CLOSED";
  metadata: unknown;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  participantCount: number;
  artifactCount: number;
  roleCounts?: {
    HOST: number;
    PRODUCER: number;
    GUEST: number;
    VIEWER: number;
  };
};

export type StudioRoomsListResponse = {
  projectId: string;
  rooms: StudioRoomSummary[];
};

export type StudioRoomCreateResponse = {
  room: {
    id: string;
    projectId: string;
    provider: string;
    roomName: string;
    status: "ACTIVE" | "CLOSED";
    metadata: unknown;
    createdAt: string;
  };
};

export type StudioRoomDetailsResponse = {
  room: {
    id: string;
    projectId: string;
    provider: string;
    roomName: string;
    status: "ACTIVE" | "CLOSED";
    metadata: unknown;
    template?: {
      id: "podcast" | "interview" | "panel";
      title: string;
      description: string;
      defaultRoles: Array<"HOST" | "PRODUCER" | "GUEST" | "VIEWER">;
    };
    startedAt: string | null;
    endedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  roleCounts?: {
    HOST: number;
    PRODUCER: number;
    GUEST: number;
    VIEWER: number;
  };
  safety?: {
    checks: Array<{ code: string; status: "PASS" | "WARN" | "FAIL"; message: string }>;
    canStartRecording: boolean;
  };
  participants: Array<{
    id: string;
    userId: string | null;
    role: "HOST" | "PRODUCER" | "GUEST" | "VIEWER";
    policy?: {
      role: "HOST" | "PRODUCER" | "GUEST" | "VIEWER";
      canManageParticipants: boolean;
      canControlRoom: boolean;
      canPublishTracks: boolean;
      canPushToTalkBypass: boolean;
      canViewDiagnostics: boolean;
    };
    displayName: string;
    externalParticipantId: string | null;
    joinedAt: string;
    leftAt: string | null;
    trackMetadata: unknown;
  }>;
};

export type StudioJoinTokenResponse = {
  join: {
    roomId: string;
    roomName: string;
    provider: string;
    livekitUrl: string | null;
    token: string;
    expiresInSec: number;
    participant: {
      id: string;
      identity: string;
      displayName: string;
      role: "HOST" | "PRODUCER" | "GUEST" | "VIEWER";
      policy?: {
        role: "HOST" | "PRODUCER" | "GUEST" | "VIEWER";
        canManageParticipants: boolean;
        canControlRoom: boolean;
        canPublishTracks: boolean;
        canPushToTalkBypass: boolean;
        canViewDiagnostics: boolean;
      };
    };
  };
};

export type StudioStartRecordingResponse = {
  started: boolean;
  room: {
    id: string;
    status: "ACTIVE" | "CLOSED";
    startedAt: string | null;
  };
  safety?: {
    checks: Array<{ code: string; status: "PASS" | "WARN" | "FAIL"; message: string }>;
    canStartRecording: boolean;
  };
};

export type StudioStopRecordingResponse = {
  stopped: boolean;
  room: {
    id: string;
    status: "ACTIVE" | "CLOSED";
    endedAt: string | null;
  };
  artifactsCreated: number;
  timeline: {
    linked: boolean;
    generatedClipCount: number;
    durationSec: number;
  };
  mergePlan?: {
    deterministicMergeId: string;
    segmentCount: number;
  };
};

export type StudioControlRoomStateResponse = {
  projectV2Id: string;
  activeRoomCount: number;
  closedRoomCount: number;
  safetyStats: {
    pass: number;
    warn: number;
    fail: number;
  };
  reliability: {
    sessionSuccessTargetPct: number;
    estimatedSessionSuccessPct: number;
  };
  rooms: Array<{
    id: string;
    roomName: string;
    status: "ACTIVE" | "CLOSED";
    participantCount: number;
    artifactCount: number;
    roleCounts: {
      HOST: number;
      PRODUCER: number;
      GUEST: number;
      VIEWER: number;
    };
    template: "podcast" | "interview" | "panel";
    pushToTalkEnabled: boolean;
    activeIssues: Array<{ id: string; note: string; status: string; createdAt: string }>;
    healthScore: number;
    startedAt: string | null;
    endedAt: string | null;
    diagnostics: string[];
    safety: {
      checks: Array<{ code: string; status: "PASS" | "WARN" | "FAIL"; message: string }>;
      canStartRecording: boolean;
    };
  }>;
};

export type StudioControlRoomActionResponse = {
  action: string;
  roomId: string;
  actorRole: "HOST" | "PRODUCER" | "GUEST" | "VIEWER";
  result: Record<string, unknown>;
  state: StudioControlRoomStateResponse;
};

export type StudioRoomTemplatesResponse = {
  templates: Array<{
    id: "podcast" | "interview" | "panel";
    title: string;
    description: string;
    defaultRoles: Array<"HOST" | "PRODUCER" | "GUEST" | "VIEWER">;
    captureProfile: Record<string, unknown>;
    recordingSafety: Record<string, unknown>;
  }>;
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
  group: "timeline" | "transcript" | "captions" | "audio";
  title: string;
  summary: string;
  items: Array<{
    id: string;
    type: "operation" | "note";
    label: string;
    before?: string;
    after?: string;
    severity?: "INFO" | "WARN" | "ERROR";
    operationIndex?: number;
  }>;
};

export type ChatSafetyMode = "APPLIED" | "APPLY_WITH_CONFIRM" | "SUGGESTIONS_ONLY";

export type ChatPlanOperationDecision = {
  itemId: string;
  accepted: boolean;
};

export type ChatConfidenceRationale = {
  averageConfidence: number;
  validPlanRate: number;
  lowConfidence: boolean;
  reasons: string[];
  fallbackReason: string | null;
};

export type ChatPlanResponse = {
  planId: string;
  planRevisionHash: string | null;
  confidence: number;
  requiresConfirmation: true;
  executionMode: "APPLIED" | "SUGGESTIONS_ONLY";
  safetyMode: ChatSafetyMode;
  confidenceRationale: ChatConfidenceRationale;
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

export type AutopilotPlanResponse = {
  sessionId: string;
  planId: string;
  planRevisionHash: string;
  safetyMode: ChatSafetyMode;
  confidence: number;
  plannerPack: AutopilotPlannerPack;
  macroId: AutopilotMacroId | null;
  macroLabel: string | null;
  confidenceRationale: ChatConfidenceRationale;
  diffGroups: AutopilotDiffGroup[];
  opsPreview: Array<{ op: string; [key: string]: unknown }>;
  constrainedSuggestions: Array<{
    id: string;
    title: string;
    prompt: string;
    reason: string;
  }>;
};

export type AutopilotApplyResponse = ChatApplyResponse & {
  sessionId: string;
};

export type AutopilotUndoResponse = {
  restored: boolean;
  appliedRevisionId: string;
};

export type AutopilotReplayResponse = {
  replayedFromSessionId: string;
  newSessionId: string;
  applied: boolean;
  requiresExplicitDecisions: boolean;
  plan: AutopilotPlanResponse;
  applyResult?: AutopilotApplyResponse;
};

export type AutopilotSessionsPayload = {
  projectId: string;
  projectV2Id: string;
  sessions: Array<{
    id: string;
    prompt: string;
    sourcePlanId: string | null;
    planRevisionHash: string;
    safetyMode: string;
    confidence: number | null;
    status: "SUCCESS" | "FAILED" | "SUGGESTIONS_ONLY";
    metadata: unknown;
    createdAt: string;
    updatedAt: string;
    actions: Array<{
      id: string;
      actionType: "PLAN" | "APPLY" | "UNDO";
      status: "SUCCESS" | "FAILED" | "SUGGESTIONS_ONLY";
      payload: unknown;
      errorMessage: string | null;
      createdAt: string;
    }>;
  }>;
  linkedChatSessions: ChatSessionSummaryPayload["sessions"];
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
  selectedOperationCount?: number;
  totalOperationCount?: number;
};

export type ChatSessionSummaryPayload = {
  projectId: string;
  projectV2Id: string;
  sessions: Array<{
    planId: string;
    createdAt: string;
    prompt: string;
    executionMode: "APPLIED" | "SUGGESTIONS_ONLY";
    confidence: number;
    safetyMode: ChatSafetyMode;
    planRevisionHash: string;
    appliedRevisionId: string | null;
    undoToken: string | null;
    issueCount: number;
    diffGroupCount: number;
  }>;
};

export type RevisionGraphPayload = {
  projectId: string;
  projectV2Id: string;
  currentRevisionId: string | null;
  nodeCount: number;
  edgeCount: number;
  nodes: Array<{
    revisionId: string;
    revisionNumber: number;
    source: string;
    summary: string;
    createdAt: string;
    isCurrent: boolean;
  }>;
  edges: Array<{
    fromRevisionId: string;
    toRevisionId: string;
    relation: "NEXT";
    reason: string;
  }>;
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

export type TranscriptDocumentSelection = {
  language: string;
  ranges: Array<{
    startWordIndex: number;
    endWordIndex: number;
    startMs: number;
    endMs: number;
    textPreview: string;
  }>;
};

export type TranscriptEditCheckpoint = {
  id: string;
  language: string;
  label: string;
  createdAt: string;
  createdByUserId: string | null;
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

export type TranscriptConflictIssue = {
  id: string;
  issueType: "LOW_CONFIDENCE" | "OVERLAP" | "TIMING_DRIFT";
  severity: "INFO" | "WARN" | "HIGH" | "CRITICAL";
  message: string;
  metadata: unknown;
  checkpointId: string | null;
  checkpointLabel: string | null;
  createdAt: string;
};

export type TranscriptConflictsPayload = {
  projectId: string;
  projectV2Id: string;
  totalConflicts: number;
  conflicts: TranscriptConflictIssue[];
};

export type TranscriptSearchReplacePayload = TranscriptOperationResult & {
  mode: "PREVIEW" | "APPLY";
  query: {
    search: string;
    replace: string;
    caseSensitive: boolean;
  };
  affectedSegments: number;
  matches: Array<{
    segmentId: string;
    before: string;
    after: string;
    startMs: number;
    endMs: number;
    confidenceAvg: number | null;
  }>;
  checkpoint?: {
    id: string;
    language: string;
    label: string;
    createdAt: string;
  };
};

export type TranscriptCheckpointsPayload = {
  projectId: string;
  projectV2Id: string;
  checkpoints: TranscriptEditCheckpoint[];
};

export type TranscriptCheckpointRestorePayload = {
  restored: boolean;
  checkpointId: string;
  revisionId: string;
  language: string;
  restoredSegments: number;
  restoredWords: number;
};

export type AudioAnalysisPayload = {
  projectId: string;
  projectV2Id: string;
  language: string;
  analysis: {
    timelineDurationMs: number;
    audioTrackCount: number;
    audioClipCount: number;
    transcriptWordCount: number;
    averageTrackVolume: number;
    averageTranscriptConfidence: number;
    estimatedNoiseLevel: number;
    estimatedLoudnessLufs: number;
    fillerCandidateCount: number;
    recommendedPreset: AudioEnhancementPreset;
    readyForApply: boolean;
  };
  fillerCandidates: AudioFillerCandidate[];
  lastRun: {
    id: string;
    operation: "ENHANCE" | "FILLER_REMOVE";
    mode: "PREVIEW" | "APPLY";
    status: "PREVIEWED" | "APPLIED" | "ERROR";
    preset: "CLEAN_VOICE" | "DIALOGUE_ENHANCE" | "BROADCAST_LOUDNESS" | "CUSTOM" | null;
    createdAt: string;
  } | null;
};

export type AudioEnhanceResultPayload = {
  mode: "PREVIEW" | "APPLY";
  runId: string;
  applied: boolean;
  suggestionsOnly: boolean;
  safetyMode: AudioSafetyMode;
  confidenceScore: number;
  safetyReasons: string[];
  revisionId: string | null;
  undoToken: string | null;
  preset: AudioEnhancementPreset;
  timelineOps: TimelineOperation[];
  issues: Array<{ code: string; message: string; severity: "INFO" | "WARN" | "ERROR" }>;
  analysisBefore: AudioAnalysisPayload["analysis"];
  analysisAfter: AudioAnalysisPayload["analysis"];
};

export type AudioFillerResultPayload = {
  mode: "PREVIEW" | "APPLY";
  runId: string;
  candidateCount: number;
  candidates: AudioFillerCandidate[];
  applied: boolean;
  suggestionsOnly: boolean;
  safetyMode: AudioSafetyMode;
  confidenceScore: number;
  safetyReasons: string[];
  revisionId: string | null;
  timelineOps: Array<{ op: string; [key: string]: unknown }>;
  issues: Array<{ code: string; message: string; severity: "INFO" | "WARN" | "ERROR" }>;
};

export type AudioSegmentAuditionPayload = {
  projectId: string;
  projectV2Id: string;
  language: string;
  segment: {
    startMs: number;
    endMs: number;
    durationMs: number;
  };
  run: {
    id: string;
    operation: "ENHANCE" | "FILLER_REMOVE";
    mode: "PREVIEW" | "APPLY";
    status: "PREVIEWED" | "APPLIED" | "ERROR";
    createdAt: string;
  } | null;
  audition: {
    beforeLabel: string;
    afterLabel: string;
    supported: boolean;
    transcriptSnippet: string;
    recommendedLoopCount: number;
    note: string;
  };
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
  guardrails?: {
    stage: "internal" | "pilot" | "small_team" | "global";
    status: "READY" | "CANARY_ONLY" | "ROLLBACK_RECOMMENDED";
    shouldRollback: boolean;
    triggers: Array<{
      code: string;
      message: string;
      severity: "WARN" | "CRITICAL";
    }>;
    parityScore: number;
    renderSuccessPct: number;
    aiSuccessPct: number;
    queueBacklog: number;
    queueFailed: number;
  };
  updatedAt: string;
};

export type OpsSloSummaryPayload = {
  workspaceId: string;
  summary: {
    since: string;
    windowHours: number;
    render: {
      total: number;
      success: number;
      successRatePct: number;
      p95LatencyMs: number;
    };
    ai: {
      total: number;
      success: number;
      successRatePct: number;
      p95LatencyMs: number;
    };
  };
};

export type OpsQueueHealthPayload = {
  workspaceId: string;
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

export type ParityLaunchReadinessPayload = {
  workspaceId: string;
  stage: "internal" | "pilot" | "small_team" | "global";
  generatedAt: string;
  rollout: {
    eligibleForStage: boolean;
    autoRollbackEnabled: boolean;
    forceRollbackToLegacy: boolean;
    allowlistSize: number;
  };
  thresholds: {
    minParityScore: number;
    minRenderSuccessPct: number;
    minAiSuccessPct: number;
    maxQueueBacklog: number;
    maxQueueFailed: number;
    maxEditorOpenP95Ms: number;
    maxCommandP95Ms: number;
    minDesktopCrashFreePct?: number;
  };
  snapshot: {
    parityScore: number;
    renderSuccessPct: number;
    aiSuccessPct: number;
    queueHealthy: boolean;
    queueBacklog: number;
    queueFailed: number;
    editorOpenP95Ms: number | null;
    commandP95Ms: number | null;
    desktopCrashFreePct?: number | null;
  };
  guardrails: {
    status: "READY" | "CANARY_ONLY" | "ROLLBACK_RECOMMENDED";
    shouldRollback: boolean;
    triggers: Array<{
      code: string;
      message: string;
      severity: "WARN" | "CRITICAL";
    }>;
  };
  scorecard: {
    overallScore: number;
    passRate: number;
    passedModules: number;
    totalModules: number;
  };
  latestBenchmark: {
    id: string;
    createdAt: string;
    finishedAt: string | null;
    summary: Record<string, unknown> | null;
    betterThanDescript: boolean | null;
  } | null;
};

export type Phase6CertificationReadoutPayload = {
  workspaceId: string;
  generatedAt: string;
  baselineDate: string;
  requiredBaselineDate: string;
  overallPassed: boolean;
  certificationPassed: boolean;
  dimensions: Array<{
    id:
      | "feature_matrix"
      | "workflow_parity"
      | "ux_slo_parity"
      | "quality_parity"
      | "ecosystem_parity"
      | "operational_parity";
    label: string;
    passed: boolean;
    summary: string;
    evidence: Record<string, unknown>;
  }>;
  streak: {
    consecutivePassDays: number;
    targetDays: number;
    passed: boolean;
  };
  monthlyDiff: {
    hasRecord: boolean;
    comparisonMonth: string | null;
    comparedAt: string | null;
    source: string | null;
    unresolvedDriftCount: number;
    discoveredFeatureCount: number;
    freshnessDays: number | null;
    currentMonth: string;
    meetsFreshnessWindow: boolean;
    meetsCurrentMonth: boolean;
    passed: boolean;
  };
  releaseCandidate: {
    frozen: boolean;
    frozenAt: string | null;
    frozenDays: number;
    releaseTag: string | null;
    notes: string | null;
  };
  pilotFeedback: {
    dogfood: {
      cohort: "dogfood";
      totalSessions: number;
      averageWorkflowSuccessPct: number | null;
      averageRating: number | null;
      totalBlockers: number;
      totalCrashes: number;
      totalParticipants: number;
    };
    pilot: {
      cohort: "pilot";
      totalSessions: number;
      averageWorkflowSuccessPct: number | null;
      averageRating: number | null;
      totalBlockers: number;
      totalCrashes: number;
      totalParticipants: number;
    };
  };
  latestBenchmark: {
    id: string;
    createdAt: string;
    finishedAt: string | null;
    betterThanDescript: boolean | null;
    summary: Record<string, unknown> | null;
  } | null;
};

export type DescriptDiffStatusPayload = {
  hasRecord: boolean;
  comparisonMonth: string | null;
  comparedAt: string | null;
  source: string | null;
  unresolvedDriftCount: number;
  discoveredFeatureCount: number;
  freshnessDays: number | null;
  currentMonth: string;
  meetsFreshnessWindow: boolean;
  meetsCurrentMonth: boolean;
  passed: boolean;
};

export type ReleaseCandidateStatusPayload = {
  frozen: boolean;
  frozenAt: string | null;
  frozenDays: number;
  releaseTag: string | null;
  notes: string | null;
};

export type Phase6PilotFeedbackRecordedPayload = {
  id: string;
  cohort: "dogfood" | "pilot";
  recordedAt: string;
};

export type BrandStudioDetails = {
  brandKit: {
    primaryColor: string | null;
    secondaryColor: string | null;
    accentColor: string | null;
    fontFamily: string | null;
    logoAssetId: string | null;
    watermarkAssetId: string | null;
  };
  customFonts: Array<{
    id: string;
    name: string;
    family: string;
    weight: number | null;
    style: "normal" | "italic";
    format: "ttf" | "otf" | "woff" | "woff2";
    assetId: string | null;
    url: string | null;
    isVariable: boolean;
    fallback: string | null;
  }>;
  layoutPacks: Array<{
    id: string;
    name: string;
    aspectRatio: string;
    sceneLayoutIds: string[];
    tags: string[];
    isDefault: boolean;
  }>;
  templatePacks: Array<{
    id: string;
    name: string;
    category: string;
    layoutPackId: string | null;
    captionStylePresetId: string | null;
    audioPreset: string | null;
    tags: string[];
    metadata: Record<string, unknown>;
  }>;
  distributionPresets: Array<{
    id: string;
    name: string;
    connector: "youtube" | "drive" | "package" | "all";
    visibility: "private" | "unlisted" | "public" | null;
    titleTemplate: string | null;
    descriptionTemplate: string | null;
    tags: string[];
    metadata: Record<string, unknown>;
    isDefault: boolean;
  }>;
  metadataPacks: Array<{
    id: string;
    name: string;
    connector: "youtube" | "drive" | "package" | "all";
    metadata: Record<string, unknown>;
    tags: string[];
  }>;
  metadata: Record<string, unknown>;
};

export type ProjectShareLinksPayload = {
  projectId: string;
  projectV2Id: string;
  shareLinks: Array<{
    id: string;
    scope: "VIEW" | "COMMENT" | "APPROVE";
    tokenPrefix: string;
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
    isActive: boolean;
    shareUrl: string;
    reviewerPageUrl: string;
  }>;
};

export type CreateShareLinkPayload = {
  shareLink: {
    id: string;
    scope: "VIEW" | "COMMENT" | "APPROVE";
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
    shareUrl: string;
    reviewerPageUrl: string;
  };
};

export type ProjectReviewCommentsPayload = {
  projectId: string;
  projectV2Id: string;
  reviewGate: {
    approvalRequired: boolean;
    latestDecision: {
      id: string;
      status: "APPROVED" | "REJECTED";
      revisionId: string | null;
      note: string | null;
      createdAt: string;
    } | null;
  };
  comments: Array<{
    id: string;
    body: string;
    status: "OPEN" | "RESOLVED";
    anchorMs: number | null;
    transcriptStartMs: number | null;
    transcriptEndMs: number | null;
    timelineTrackId: string | null;
    clipId: string | null;
    createdAt: string;
    updatedAt: string;
    author: {
      id: string;
      email: string;
    } | null;
    resolvedBy: {
      id: string;
      email: string;
    } | null;
    resolvedAt: string | null;
    anchorIntegrity: {
      trackExists: boolean;
      clipExists: boolean;
      transcriptOverlapCount: number;
    };
  }>;
};

export type CreateReviewCommentPayload = {
  comment: {
    id: string;
    body: string;
    status: "OPEN" | "RESOLVED";
    anchorMs: number | null;
    transcriptStartMs: number | null;
    transcriptEndMs: number | null;
    timelineTrackId: string | null;
    clipId: string | null;
    createdAt: string;
    updatedAt: string;
    author: {
      id: string;
      email: string;
    } | null;
  };
};

export type UpdateReviewCommentStatusPayload = {
  comment: {
    id: string;
    status: "OPEN" | "RESOLVED";
    resolvedAt: string | null;
    resolvedByUserId: string | null;
  };
};

export type SubmitReviewDecisionPayload = {
  decision: {
    id: string;
    status: "APPROVED" | "REJECTED";
    revisionId: string | null;
    note: string | null;
    createdAt: string;
  };
  approvalRequired: boolean;
};

export type ProjectReviewRequestsPayload = {
  projectId: string;
  projectV2Id: string;
  requests: Array<{
    id: string;
    title: string;
    note: string | null;
    requiredScopes: string[];
    status: "PENDING" | "APPROVED" | "REJECTED";
    decisionId: string | null;
    decidedAt: string | null;
    decidedByUserId: string | null;
    createdAt: string;
    updatedAt: string;
    approvalChain: Array<{
      id: string;
      role: "OWNER" | "ADMIN" | "EDITOR";
      label: string;
      required: boolean;
      order: number;
    }>;
    approvalChainState: {
      steps: Array<{
        id: string;
        role: "OWNER" | "ADMIN" | "EDITOR";
        label: string;
        required: boolean;
        order: number;
        status: "APPROVED" | "REJECTED" | "PENDING";
        decidedByUserId: string | null;
        decidedAt: string | null;
      }>;
      totalRequiredCount: number;
      completedRequiredCount: number;
      hasRejection: boolean;
      isComplete: boolean;
      nextRequiredStepId: string | null;
    };
    logs: Array<{
      id: string;
      status: "APPROVED" | "REJECTED";
      note: string | null;
      decidedByUserId: string | null;
      createdAt: string;
      approvalChainStepId: string | null;
    }>;
  }>;
};

export type CreateReviewRequestPayload = {
  request: {
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    title: string;
    note: string | null;
    requiredScopes: string[];
    approvalChain: Array<{
      id: string;
      role: "OWNER" | "ADMIN" | "EDITOR";
      label: string;
      required: boolean;
      order: number;
    }>;
    createdAt: string;
  };
};

export type DecideReviewRequestPayload = {
  request: {
    id: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    decisionId: string | null;
    decidedAt: string | null;
    decidedByUserId: string | null;
    approvalChainState: {
      steps: Array<{
        id: string;
        role: "OWNER" | "ADMIN" | "EDITOR";
        label: string;
        required: boolean;
        order: number;
        status: "APPROVED" | "REJECTED" | "PENDING";
        decidedByUserId: string | null;
        decidedAt: string | null;
      }>;
      totalRequiredCount: number;
      completedRequiredCount: number;
      hasRejection: boolean;
      isComplete: boolean;
      nextRequiredStepId: string | null;
    };
  };
  decision: SubmitReviewDecisionPayload["decision"];
  logId: string;
  approvalChainStepId: string;
};

export type ExportProfilesPayload = {
  workspaceId: string;
  projectV2Id: string;
  exportProfiles: Array<{
    id: string;
    name: string;
    container: string;
    resolution: string;
    fps: number;
    videoBitrateKbps: number | null;
    audioBitrateKbps: number | null;
    audioPreset: string | null;
    captionStylePresetId: string | null;
    isDefault: boolean;
    config: unknown;
    updatedAt: string;
  }>;
};

export type ApplyExportProfilePayload = {
  applied: boolean;
  profile: {
    id: string;
    name: string;
    container: string;
    resolution: string;
    fps: number;
    videoBitrateKbps: number | null;
    audioBitrateKbps: number | null;
    audioPreset: string | null;
    captionStylePresetId: string | null;
    isDefault: boolean;
  };
  exportProfiles: Array<{
    id: string;
    name: string;
    container: string;
    resolution: string;
    fps: number;
    videoBitrateKbps: number | null;
    audioBitrateKbps: number | null;
    audioPreset: string | null;
    captionStylePresetId: string | null;
    isDefault: boolean;
    updatedAt: string;
  }>;
};

export type WorkspaceBrandPresetPayload = {
  workspaceId: string;
  projectV2Id: string;
  brandPreset: {
    id: string | null;
    name: string;
    captionStylePresetId: string | null;
    audioPreset: string | null;
    defaultConnector: "youtube" | "drive" | "package";
    defaultVisibility: "private" | "unlisted" | "public";
    defaultTitlePrefix: string | null;
    defaultTags: string[];
    metadata: Record<string, unknown>;
    details: BrandStudioDetails;
    createdAt: string | null;
    updatedAt: string | null;
  };
  exportProfileDefaults: {
    id: string;
    name: string;
    container: string;
    resolution: string;
    fps: number;
    audioPreset: string | null;
    captionStylePresetId: string | null;
    updatedAt: string;
  } | null;
  captionStylePresets: Array<{
    id: string;
    name: string;
    isSystem: boolean;
  }>;
};

export type WorkspaceBrandPresetUpsertPayload = {
  workspaceId: string;
  projectV2Id: string;
  brandPreset: {
    id: string;
    name: string;
    captionStylePresetId: string | null;
    audioPreset: string | null;
    defaultConnector: "youtube" | "drive" | "package";
    defaultVisibility: "private" | "unlisted" | "public";
    defaultTitlePrefix: string | null;
    defaultTags: string[];
    metadata: Record<string, unknown> | null;
    details: BrandStudioDetails;
    createdAt: string;
    updatedAt: string;
  };
  linkedExportProfile: {
    id: string;
    name: string;
    isDefault: boolean;
    audioPreset: string | null;
    captionStylePresetId: string | null;
    updatedAt: string;
  };
};

export type PublishConnectorJobPayload = {
  projectId: string;
  projectV2Id: string;
  publishJob: {
    id: string;
    connector: string;
    status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
    output: unknown;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  };
};

export type PublishConnectorBatchPayload = {
  projectId: string | null;
  projectV2Id: string | null;
  jobs: Array<{
    id: string;
    connector: string;
    status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
    output: unknown;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  summary: {
    total: number;
    done: number;
    error: number;
    byConnector: Record<string, number>;
  };
};

export type DistributionPresetsPayload = {
  workspaceId: string;
  projectV2Id: string;
  distributionPresets: BrandStudioDetails["distributionPresets"];
  metadataPacks: BrandStudioDetails["metadataPacks"];
  updatedAt: string | null;
};

export type ReviewerPagePayload = {
  workspaceId: string;
  projectId: string;
  projectV2Id: string;
  reviewerPage: {
    projectTitle: string;
    currentRevisionId: string | null;
    approvalRequired: boolean;
    accessSource: "AUTH" | "SHARE_LINK";
    shareLink: {
      id: string;
      scope: "VIEW" | "COMMENT" | "APPROVE";
      expiresAt: string | null;
      reviewerPageUrl: string;
    } | null;
  };
  summary: {
    comments: {
      total: number;
      open: number;
      resolved: number;
    };
    publish: {
      total: number;
      done: number;
      error: number;
      running: number;
    };
    latestDecision: {
      id: string;
      status: "APPROVED" | "REJECTED";
      revisionId: string | null;
      note: string | null;
      decidedByUserId: string | null;
      createdAt: string;
    } | null;
  };
  reviewRequests: ProjectReviewRequestsPayload["requests"];
  shareLinks: Array<{
    id: string;
    scope: "VIEW" | "COMMENT" | "APPROVE";
    createdAt: string;
    isActive: boolean;
    reviewerPageUrl: string;
  }>;
  recentComments: Array<{
    id: string;
    status: "OPEN" | "RESOLVED";
    body: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
  recentPublishJobs: Array<{
    id: string;
    connector: string;
    status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
    createdAt: string;
    updatedAt: string;
  }>;
};

export type ReviewVersionComparePayload = {
  projectId: string;
  projectV2Id: string;
  comparable: boolean;
  baseRevision: {
    id: string;
    revisionNumber: number;
    timelineHash: string;
    createdAt: string;
    createdBy: {
      id: string;
      email: string;
    } | null;
  } | null;
  targetRevision: {
    id: string;
    revisionNumber: number;
    timelineHash: string;
    createdAt: string;
    createdBy: {
      id: string;
      email: string;
    } | null;
  };
  summary: {
    base: {
      total: number;
      byType: Record<string, number>;
      sample: Array<{ op: string; keys: string[] }>;
    } | null;
    target: {
      total: number;
      byType: Record<string, number>;
      sample: Array<{ op: string; keys: string[] }>;
    };
    changedOperationCount: number;
    deltaByType: Record<string, number>;
  };
};

export type ReviewAuditTrailPayload = {
  workspaceId: string;
  projectId: string;
  projectV2Id: string;
  events: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId: string | null;
    actorUserId: string | null;
    severity: string;
    metadata: unknown;
    createdAt: string;
  }>;
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

type DesktopEventRequest = {
  projectId?: string;
  event:
    | "editor_boot"
    | "command_latency"
    | "background_upload_notice"
    | "background_render_notice"
    | "drop_import"
    | "drag_drop_ingest"
    | "offline_draft_sync"
    | "media_relink"
    | "desktop_notification"
    | "app_crash"
    | "native_crash"
    | "update_check"
    | "update_apply"
    | "desktop_menu_action"
    | "desktop_shortcut_action";
  outcome?: "SUCCESS" | "ERROR" | "INFO";
  durationMs?: number;
  sessionId?: string;
  clientVersion?: string;
  channel?: "stable" | "beta" | "canary";
  platform?: "darwin-arm64" | "darwin-x64" | "win32-x64";
  metadata?: Record<string, unknown>;
};

type DesktopDropIngestRequest = {
  files: Array<{
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    durationSec?: number;
    sourcePath?: string;
  }>;
};

type DesktopOfflineDraftUpsertRequest = {
  draftId: string;
  clientId: string;
  basedOnRevisionId?: string | null;
  clear?: boolean;
  operations?: Array<Record<string, unknown>>;
};

type DesktopMediaRelinkRequest = {
  missingAssets: Array<{
    assetId: string;
    originalFileName: string;
    expectedDurationSec?: number;
    expectedSizeBytes?: number;
  }>;
  candidates: Array<{
    candidateId?: string;
    fileName: string;
    absolutePath: string;
    durationSec?: number;
    sizeBytes?: number;
  }>;
  apply?: boolean;
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

export type DesktopConfigPayload = {
  desktop: {
    supported: boolean;
    shell: string;
    status: string;
    appId: string;
    defaultUpdateChannel: "stable" | "beta" | "canary";
    packagedTargets: {
      macos: {
        supported: boolean;
        architectures: Array<"arm64" | "x64">;
        signedBuilds: boolean;
        installerFormats: string[];
      };
      windows: {
        supported: boolean;
        architectures: Array<"x64">;
        signedBuilds: boolean;
        installerFormats: string[];
      };
    };
    autoUpdate: {
      enabled: boolean;
      channels: Array<"stable" | "beta" | "canary">;
      releaseEndpoint: string;
    };
    crashReporting: {
      enabled: boolean;
      eventCategories: string[];
      privacy: string;
    };
  };
  cutover: {
    defaultEditorShell: "OPENCUT" | "LEGACY";
    immediateReplacement: boolean;
    legacyFallbackAllowlistEnabled: boolean;
  };
  budgets: {
    editorOpenP95Ms: number;
    commandLatencyP95Ms: number;
    crashFreeSessionsPct: number;
  };
  desktopCi: {
    paritySuite: string;
    requiredTargets: Array<"darwin-arm64" | "darwin-x64" | "win32-x64">;
    crashFreeTargetPct: number;
  };
  nativeMenu: Array<{
    id: string;
    label: string;
    shortcut: string;
  }>;
  shortcuts: {
    transport: string[];
    timeline: string[];
    transcript: string[];
    desktop: string[];
  };
  workflows: {
    dragDropIngest: boolean;
    offlineDraftSync: boolean;
    mediaRelink: boolean;
    desktopNotifications: boolean;
  };
  endpoints: {
    desktopEvents: string;
    desktopReleases: string;
    projectPerfHints: string;
    projectDesktopIngestDrop: string;
    projectDesktopOfflineDrafts: string;
    projectDesktopMediaRelink: string;
    projectDesktopNotifications: string;
    queueHealth: string;
  };
};

export type ProjectPerfHintsPayload = {
  projectId: string;
  legacyProjectId: string;
  counts: {
    tracks: number;
    clips: number;
    transcriptSegments: number;
    transcriptWords: number;
  };
  desktopSlo: {
    crashFreeSessionsTargetPct: number;
    crashFreeSessionsPct: number | null;
    totalSessions: number;
    crashSessions: number;
    largeProjectMode: boolean;
  };
  budgets: {
    editorOpenP95Ms: number;
    commandLatencyP95Ms: number;
  };
  observed: {
    editorOpenP95Ms: number | null;
    commandLatencyP95Ms: number | null;
  };
  suggested: {
    timelineWindowSize: number;
    segmentWindowSize: number;
    enableLaneCollapse: boolean;
    preferredZoomPercent: number;
  };
  hints: Array<{
    id: string;
    severity: "INFO" | "WARN";
    message: string;
    action: string;
  }>;
  updatedAt: string;
};

export type DesktopReleasesPayload = {
  generatedAt: string;
  platform: "darwin-arm64" | "darwin-x64" | "win32-x64";
  channel: "stable" | "beta" | "canary";
  currentVersion: string | null;
  latest: {
    version: string;
    platform: "darwin-arm64" | "darwin-x64" | "win32-x64";
    channel: "stable" | "beta" | "canary";
    buildId: string;
    publishedAt: string;
    downloadUrl: string;
    checksumSha256: string;
    signature: string;
    signed: boolean;
    notes: string;
    minOsVersion: string | null;
  } | null;
  updateAvailable: boolean;
  signedReleaseCount: number;
};

export type ProjectDesktopDropIngestPayload = {
  projectId: string;
  projectV2Id: string;
  ingestPlan: {
    accepted: Array<{
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      slot: "primary" | "broll" | "audio";
      reason: string;
    }>;
    rejected: Array<{
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      reason: string;
    }>;
    summary: {
      total: number;
      accepted: number;
      rejected: number;
    };
  };
  nextStep: {
    presignEndpoint: string;
    registerEndpoint: string;
  };
};

export type ProjectDesktopOfflineDraftsPayload = {
  projectId: string;
  projectV2Id: string;
  currentRevisionId: string | null;
  drafts: Array<{
    draftId: string;
    clientId: string;
    basedOnRevisionId: string | null;
    operations: Array<Record<string, unknown>>;
    status: "IN_SYNC" | "DIRTY" | "CONFLICT";
    updatedAt: string;
  }>;
  summary: {
    total: number;
    dirty: number;
    conflict: number;
    inSync: number;
  };
  updatedAt: string;
};

export type ProjectDesktopOfflineDraftUpsertPayload = ProjectDesktopOfflineDraftsPayload & {
  draft: ProjectDesktopOfflineDraftsPayload["drafts"][number] | null;
};

export type ProjectDesktopMediaRelinkPayload = {
  projectId: string;
  projectV2Id: string;
  recommendations: Array<{
    assetId: string;
    status: "MATCHED" | "UNMATCHED";
    selectedCandidate: {
      candidateId: string;
      fileName: string;
      absolutePath: string;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      score: number;
    } | null;
    alternatives: Array<{
      candidateId: string;
      fileName: string;
      absolutePath: string;
      score: number;
    }>;
  }>;
  summary: {
    totalMissing: number;
    matched: number;
    unmatched: number;
    highConfidenceMatches: number;
  };
  applied: boolean;
};

export type ProjectDesktopNotificationsPayload = {
  projectId: string;
  projectV2Id: string;
  notifications: Array<{
    id: string;
    kind: "UPLOAD" | "RENDER" | "RELINK" | "OFFLINE_DRAFT" | "SYSTEM";
    severity: "INFO" | "WARN" | "CRITICAL";
    title: string;
    body: string;
    createdAt: string;
    action: {
      type: "OPEN_PANEL" | "OPEN_SETTINGS" | "OPEN_PROJECT";
      payload: string;
    };
  }>;
  summary: {
    total: number;
    unread: number;
    acknowledged: number;
  };
  updatedAt: string;
};

export type ProjectDesktopNotificationsAckPayload = {
  projectId: string;
  projectV2Id: string;
  acknowledgedCount: number;
  totalAcknowledged: number;
  updatedAt: string;
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

export async function getProjectV2AudioAnalysis(projectV2Id: string, language: string, maxCandidates = 120, maxConfidence = 0.94) {
  return requestJson<AudioAnalysisPayload>(
    `/api/projects-v2/${projectV2Id}/audio/analysis?language=${encodeURIComponent(language)}&maxCandidates=${maxCandidates}&maxConfidence=${maxConfidence}`
  );
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

export async function getTranscriptConflicts(
  projectV2Id: string,
  params: {
    language?: string;
    issueType?: "LOW_CONFIDENCE" | "OVERLAP" | "TIMING_DRIFT";
    severity?: "INFO" | "WARN" | "HIGH" | "CRITICAL";
    limit?: number;
  } = {}
) {
  const query = new URLSearchParams();
  if (params.language) {
    query.set("language", params.language);
  }
  if (params.issueType) {
    query.set("issueType", params.issueType);
  }
  if (params.severity) {
    query.set("severity", params.severity);
  }
  if (typeof params.limit === "number") {
    query.set("limit", String(params.limit));
  }
  const suffix = query.toString();
  return requestJson<TranscriptConflictsPayload>(
    `/api/projects-v2/${projectV2Id}/transcript/conflicts${suffix ? `?${suffix}` : ""}`
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

export async function previewTranscriptSearchReplace(projectV2Id: string, body: TranscriptSearchReplaceRequest) {
  return requestJson<TranscriptSearchReplacePayload>(`/api/projects-v2/${projectV2Id}/transcript/search-replace/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function applyTranscriptSearchReplace(projectV2Id: string, body: TranscriptSearchReplaceRequest) {
  return requestJson<TranscriptSearchReplacePayload>(`/api/projects-v2/${projectV2Id}/transcript/search-replace/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function createTranscriptCheckpoint(projectV2Id: string, body: TranscriptCheckpointCreateRequest = {}) {
  return requestJson<{ checkpoint: { id: string; language: string; label: string; createdAt: string } }>(
    `/api/projects-v2/${projectV2Id}/transcript/checkpoints/create`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}

export async function listTranscriptCheckpoints(projectV2Id: string, language?: string) {
  return requestJson<TranscriptCheckpointsPayload>(
    `/api/projects-v2/${projectV2Id}/transcript/checkpoints${language ? `?language=${encodeURIComponent(language)}` : ""}`
  );
}

export async function restoreTranscriptCheckpoint(projectV2Id: string, checkpointId: string) {
  return requestJson<TranscriptCheckpointRestorePayload>(
    `/api/projects-v2/${projectV2Id}/transcript/checkpoints/${checkpointId}/restore`,
    {
      method: "POST"
    }
  );
}

export async function previewProjectV2AudioEnhancement(projectV2Id: string, body: AudioEnhanceRequest) {
  return requestJson<AudioEnhanceResultPayload>(`/api/projects-v2/${projectV2Id}/audio/enhance/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function applyProjectV2AudioEnhancement(projectV2Id: string, body: AudioEnhanceRequest) {
  return requestJson<AudioEnhanceResultPayload>(`/api/projects-v2/${projectV2Id}/audio/enhance/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function undoProjectV2AudioEnhancement(projectV2Id: string, undoToken: string, force = false) {
  return requestJson<{ restored: boolean; appliedRevisionId: string }>(`/api/projects-v2/${projectV2Id}/audio/enhance/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ undoToken, force })
  });
}

export async function previewProjectV2FillerRemoval(projectV2Id: string, body: AudioFillerRequest) {
  return requestJson<AudioFillerResultPayload>(`/api/projects-v2/${projectV2Id}/audio/filler/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function applyProjectV2FillerRemoval(projectV2Id: string, body: AudioFillerRequest) {
  return requestJson<AudioFillerResultPayload>(`/api/projects-v2/${projectV2Id}/audio/filler/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2AudioSegmentAudition(
  projectV2Id: string,
  body: { runId?: string; startMs: number; endMs: number; language?: string }
) {
  return requestJson<AudioSegmentAuditionPayload>(`/api/projects-v2/${projectV2Id}/audio/ab/segment`, {
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

export async function recoverProjectV2RecordingSession(
  projectIdOrV2Id: string,
  sessionId: string,
  body: { mode?: "resume" | "status_only"; reason?: string } = {}
) {
  return requestJson<RecordingSessionRecoverResponse>(
    `/api/projects-v2/${projectIdOrV2Id}/recordings/session/${sessionId}/recover`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}

export async function listProjectV2StudioRooms(projectIdOrV2Id: string) {
  return requestJson<StudioRoomsListResponse>(`/api/projects-v2/${projectIdOrV2Id}/studio/rooms`);
}

export async function createProjectV2StudioRoom(
  projectIdOrV2Id: string,
  body: { name?: string; template?: "podcast" | "interview" | "panel"; region?: string; metadata?: Record<string, unknown> }
) {
  return requestJson<StudioRoomCreateResponse>(`/api/projects-v2/${projectIdOrV2Id}/studio/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function listProjectV2StudioRoomTemplates(projectIdOrV2Id: string) {
  return requestJson<StudioRoomTemplatesResponse>(`/api/projects-v2/${projectIdOrV2Id}/studio/rooms/templates`);
}

export async function getProjectV2StudioRoom(projectIdOrV2Id: string, roomId: string) {
  return requestJson<StudioRoomDetailsResponse>(`/api/projects-v2/${projectIdOrV2Id}/studio/rooms/${roomId}`);
}

export async function issueProjectV2StudioJoinToken(
  projectIdOrV2Id: string,
  roomId: string,
  body: {
    participantName: string;
    role: "HOST" | "PRODUCER" | "GUEST" | "VIEWER";
    pushToTalk?: boolean;
    ttlSec?: number;
  }
) {
  return requestJson<StudioJoinTokenResponse>(`/api/projects-v2/${projectIdOrV2Id}/studio/rooms/${roomId}/join-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2StudioControlRoomState(projectIdOrV2Id: string) {
  return requestJson<StudioControlRoomStateResponse>(`/api/projects-v2/${projectIdOrV2Id}/studio/control-room/state`);
}

export async function postProjectV2StudioControlRoomAction(
  projectIdOrV2Id: string,
  body: {
    roomId: string;
    action:
      | "participant_mute"
      | "participant_unmute"
      | "participant_remove"
      | "push_to_talk_enable"
      | "push_to_talk_disable"
      | "run_safety_checks"
      | "mark_issue"
      | "resolve_issue";
    participantId?: string;
    issueId?: string;
    note?: string;
  }
) {
  return requestJson<StudioControlRoomActionResponse>(`/api/projects-v2/${projectIdOrV2Id}/studio/control-room/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function startProjectV2StudioRecording(projectIdOrV2Id: string, roomId: string) {
  return requestJson<StudioStartRecordingResponse>(
    `/api/projects-v2/${projectIdOrV2Id}/studio/rooms/${roomId}/start-recording`,
    {
      method: "POST"
    }
  );
}

export async function stopProjectV2StudioRecording(projectIdOrV2Id: string, roomId: string) {
  return requestJson<StudioStopRecordingResponse>(
    `/api/projects-v2/${projectIdOrV2Id}/studio/rooms/${roomId}/stop-recording`,
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

export async function getProjectV2ChatSessions(projectIdOrV2Id: string, limit = 20) {
  return requestJson<ChatSessionSummaryPayload>(`/api/projects-v2/${projectIdOrV2Id}/chat/sessions?limit=${limit}`);
}

export async function getProjectV2RevisionGraph(projectIdOrV2Id: string, limit = 200) {
  return requestJson<RevisionGraphPayload>(`/api/projects-v2/${projectIdOrV2Id}/revisions/graph?limit=${limit}`);
}

export async function planProjectV2Autopilot(projectIdOrV2Id: string, body: AutopilotPlanRequest) {
  return requestJson<AutopilotPlanResponse>(`/api/projects-v2/${projectIdOrV2Id}/autopilot/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function applyProjectV2Autopilot(projectIdOrV2Id: string, body: AutopilotApplyRequest) {
  return requestJson<AutopilotApplyResponse>(`/api/projects-v2/${projectIdOrV2Id}/autopilot/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function undoProjectV2Autopilot(projectIdOrV2Id: string, body: AutopilotUndoRequest) {
  return requestJson<AutopilotUndoResponse>(`/api/projects-v2/${projectIdOrV2Id}/autopilot/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function replayProjectV2Autopilot(projectIdOrV2Id: string, body: AutopilotReplayRequest) {
  return requestJson<AutopilotReplayResponse>(`/api/projects-v2/${projectIdOrV2Id}/autopilot/replay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2AutopilotSessions(projectIdOrV2Id: string, limit = 30) {
  return requestJson<AutopilotSessionsPayload>(`/api/projects-v2/${projectIdOrV2Id}/autopilot/sessions?limit=${limit}`);
}

export async function getProjectV2EditorState(projectIdOrV2Id: string) {
  return requestJson<EditorStatePayload>(`/api/projects-v2/${projectIdOrV2Id}/editor-state`);
}

export async function getProjectV2EditorHealth(projectIdOrV2Id: string) {
  return requestJson<EditorHealthStatus>(`/api/projects-v2/${projectIdOrV2Id}/editor-health`);
}

export async function getOpsSloSummary(windowHours = 24) {
  return requestJson<OpsSloSummaryPayload>(`/api/ops/slo/summary?windowHours=${windowHours}`);
}

export async function getOpsQueueHealth() {
  return requestJson<OpsQueueHealthPayload>("/api/ops/queues/health");
}

export async function getParityLaunchReadiness() {
  return requestJson<ParityLaunchReadinessPayload>("/api/parity/launch/readiness");
}

export async function getPhase6CertificationReadout() {
  return requestJson<Phase6CertificationReadoutPayload>("/api/parity/certification/readout");
}

export async function runPhase6Certification() {
  return requestJson<Phase6CertificationReadoutPayload>("/api/parity/certification/run", {
    method: "POST"
  });
}

export async function getParityDescriptDiffStatus() {
  return requestJson<DescriptDiffStatusPayload>("/api/parity/descript-diff");
}

export async function recordParityDescriptDiff(body: RecordDescriptDiffRequest) {
  return requestJson<DescriptDiffStatusPayload>("/api/parity/descript-diff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getParityReleaseCandidateStatus() {
  return requestJson<ReleaseCandidateStatusPayload>("/api/parity/release-candidate");
}

export async function freezeParityReleaseCandidate(body: FreezeReleaseCandidateRequest) {
  return requestJson<ReleaseCandidateStatusPayload>("/api/parity/release-candidate/freeze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function unfreezeParityReleaseCandidate(body: UnfreezeReleaseCandidateRequest = {}) {
  return requestJson<ReleaseCandidateStatusPayload>("/api/parity/release-candidate/unfreeze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function recordPhase6PilotFeedback(body: RecordPhase6PilotFeedbackRequest) {
  return requestJson<Phase6PilotFeedbackRecordedPayload>("/api/parity/pilot-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2PerfHints(projectIdOrV2Id: string) {
  return requestJson<ProjectPerfHintsPayload>(`/api/projects-v2/${projectIdOrV2Id}/perf-hints`);
}

export async function getProjectV2ShareLinks(projectIdOrV2Id: string) {
  return requestJson<ProjectShareLinksPayload>(`/api/projects-v2/${projectIdOrV2Id}/share-links`);
}

export async function createProjectV2ShareLink(projectIdOrV2Id: string, body: CreateShareLinkRequest) {
  return requestJson<CreateShareLinkPayload>(`/api/projects-v2/${projectIdOrV2Id}/share-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2ReviewComments(projectIdOrV2Id: string, shareToken?: string) {
  const suffix = shareToken ? `?shareToken=${encodeURIComponent(shareToken)}` : "";
  return requestJson<ProjectReviewCommentsPayload>(`/api/projects-v2/${projectIdOrV2Id}/review/comments${suffix}`);
}

export async function createProjectV2ReviewComment(projectIdOrV2Id: string, body: CreateReviewCommentRequest) {
  return requestJson<CreateReviewCommentPayload>(`/api/projects-v2/${projectIdOrV2Id}/review/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function updateProjectV2ReviewCommentStatus(
  projectIdOrV2Id: string,
  commentId: string,
  body: UpdateReviewCommentStatusRequest
) {
  return requestJson<UpdateReviewCommentStatusPayload>(`/api/projects-v2/${projectIdOrV2Id}/review/comments/${commentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function submitProjectV2ReviewDecision(projectIdOrV2Id: string, body: SubmitReviewDecisionRequest) {
  return requestJson<SubmitReviewDecisionPayload>(`/api/projects-v2/${projectIdOrV2Id}/review/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function listProjectV2ReviewRequests(projectIdOrV2Id: string, limit = 30) {
  return requestJson<ProjectReviewRequestsPayload>(`/api/projects-v2/${projectIdOrV2Id}/review/requests?limit=${limit}`);
}

export async function createProjectV2ReviewRequest(projectIdOrV2Id: string, body: CreateReviewRequestRequest) {
  return requestJson<CreateReviewRequestPayload>(`/api/projects-v2/${projectIdOrV2Id}/review/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function decideProjectV2ReviewRequest(
  projectIdOrV2Id: string,
  requestId: string,
  body: DecideReviewRequestRequest
) {
  return requestJson<DecideReviewRequestPayload>(
    `/api/projects-v2/${projectIdOrV2Id}/review/requests/${requestId}/decision`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}

export async function getProjectV2ReviewerPage(projectIdOrV2Id: string, shareToken?: string) {
  const suffix = shareToken ? `?shareToken=${encodeURIComponent(shareToken)}` : "";
  return requestJson<ReviewerPagePayload>(`/api/projects-v2/${projectIdOrV2Id}/review/reviewer-page${suffix}`);
}

export async function getProjectV2ReviewVersionCompare(
  projectIdOrV2Id: string,
  params?: { baseRevisionId?: string; targetRevisionId?: string }
) {
  const searchParams = new URLSearchParams();
  if (params?.baseRevisionId) {
    searchParams.set("baseRevisionId", params.baseRevisionId);
  }
  if (params?.targetRevisionId) {
    searchParams.set("targetRevisionId", params.targetRevisionId);
  }
  const suffix = searchParams.toString();
  return requestJson<ReviewVersionComparePayload>(
    `/api/projects-v2/${projectIdOrV2Id}/review/version-compare${suffix ? `?${suffix}` : ""}`
  );
}

export async function getProjectV2ReviewAuditTrail(projectIdOrV2Id: string, limit = 100) {
  return requestJson<ReviewAuditTrailPayload>(`/api/projects-v2/${projectIdOrV2Id}/review/audit?limit=${limit}`);
}

export async function getProjectV2ExportProfiles(projectIdOrV2Id: string) {
  return requestJson<ExportProfilesPayload>(`/api/projects-v2/${projectIdOrV2Id}/export/profile`);
}

export async function applyProjectV2ExportProfile(projectIdOrV2Id: string, body: ApplyExportProfileRequest) {
  return requestJson<ApplyExportProfilePayload>(`/api/projects-v2/${projectIdOrV2Id}/export/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2BrandPreset(projectIdOrV2Id: string) {
  return requestJson<WorkspaceBrandPresetPayload>(`/api/projects-v2/${projectIdOrV2Id}/brand-preset`);
}

export async function upsertProjectV2BrandPreset(projectIdOrV2Id: string, body: BrandPresetUpsertRequest) {
  return requestJson<WorkspaceBrandPresetUpsertPayload>(`/api/projects-v2/${projectIdOrV2Id}/brand-preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function publishProjectV2Connector(
  projectIdOrV2Id: string,
  connector: "youtube" | "drive" | "package",
  body: PublishConnectorExportRequest = {}
) {
  return requestJson<PublishConnectorJobPayload>(
    `/api/projects-v2/${projectIdOrV2Id}/publish/connectors/${connector}/export`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );
}

export async function publishProjectV2ConnectorBatch(projectIdOrV2Id: string, body: PublishConnectorBatchRequest) {
  return requestJson<PublishConnectorBatchPayload>(`/api/projects-v2/${projectIdOrV2Id}/publish/connectors/batch/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2DistributionPresets(projectIdOrV2Id: string) {
  return requestJson<DistributionPresetsPayload>(`/api/projects-v2/${projectIdOrV2Id}/publish/distribution-presets`);
}

export async function getProjectV2PublishJob(projectIdOrV2Id: string, jobId: string) {
  return requestJson<{
    projectId: string;
    projectV2Id: string;
    publishJob: {
      id: string;
      connector: string;
      status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
      payload: unknown;
      output: unknown;
      errorMessage: string | null;
      createdAt: string;
      updatedAt: string;
    };
  }>(`/api/projects-v2/${projectIdOrV2Id}/publish/jobs/${jobId}`);
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

export async function getDesktopConfig() {
  return requestJson<DesktopConfigPayload>(`/api/desktop/config`);
}

export async function getDesktopReleases(params?: {
  platform?: "darwin-arm64" | "darwin-x64" | "win32-x64";
  channel?: "stable" | "beta" | "canary";
  currentVersion?: string;
}) {
  const search = new URLSearchParams();
  if (params?.platform) {
    search.set("platform", params.platform);
  }
  if (params?.channel) {
    search.set("channel", params.channel);
  }
  if (params?.currentVersion) {
    search.set("currentVersion", params.currentVersion);
  }
  const suffix = search.toString();
  return requestJson<DesktopReleasesPayload>(`/api/desktop/releases${suffix ? `?${suffix}` : ""}`);
}

export async function trackDesktopEvent(body: DesktopEventRequest) {
  return requestJson<{ tracked: boolean; eventId: string; createdAt: string }>(`/api/desktop/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function planProjectV2DesktopDropIngest(projectIdOrV2Id: string, body: DesktopDropIngestRequest) {
  return requestJson<ProjectDesktopDropIngestPayload>(`/api/projects-v2/${projectIdOrV2Id}/desktop/ingest-drop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2DesktopOfflineDrafts(projectIdOrV2Id: string) {
  return requestJson<ProjectDesktopOfflineDraftsPayload>(`/api/projects-v2/${projectIdOrV2Id}/desktop/offline-drafts`);
}

export async function upsertProjectV2DesktopOfflineDraft(
  projectIdOrV2Id: string,
  body: DesktopOfflineDraftUpsertRequest
) {
  return requestJson<ProjectDesktopOfflineDraftUpsertPayload>(`/api/projects-v2/${projectIdOrV2Id}/desktop/offline-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function recommendProjectV2DesktopMediaRelink(
  projectIdOrV2Id: string,
  body: DesktopMediaRelinkRequest
) {
  return requestJson<ProjectDesktopMediaRelinkPayload>(`/api/projects-v2/${projectIdOrV2Id}/desktop/media-relink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function getProjectV2DesktopNotifications(projectIdOrV2Id: string, includeAcknowledged = false) {
  const suffix = includeAcknowledged ? "?includeAcknowledged=1" : "";
  return requestJson<ProjectDesktopNotificationsPayload>(`/api/projects-v2/${projectIdOrV2Id}/desktop/notifications${suffix}`);
}

export async function acknowledgeProjectV2DesktopNotifications(projectIdOrV2Id: string, notificationIds: string[]) {
  return requestJson<ProjectDesktopNotificationsAckPayload>(`/api/projects-v2/${projectIdOrV2Id}/desktop/notifications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notificationIds })
  });
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
