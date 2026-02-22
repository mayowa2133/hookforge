"use client";

export type ApiErrorPayload = {
  error?: string;
};

export type ProjectV2ApiPayload = {
  project: {
    id: string;
    title: string;
    status: string;
    legacyProjectId: string | null;
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
      clips: Array<{
        id: string;
        label: string;
        timelineInMs: number;
        timelineOutMs: number;
      }>;
    }>;
  };
  revisionId: string | null;
  revision: number;
};

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
  return requestJson<TimelinePayload>(`/api/projects/${projectIdOrV2Id}/timeline`);
}

export async function getTranscript(projectV2Id: string, language: string) {
  return requestJson<TranscriptPayload>(`/api/projects-v2/${projectV2Id}/transcript?language=${encodeURIComponent(language)}`);
}

export async function autoTranscript(projectV2Id: string, body: TranscriptAutoRequest) {
  return requestJson<{ aiJobId: string; status: string; trackId: string }>(`/api/projects-v2/${projectV2Id}/transcript/auto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function patchTranscript(projectV2Id: string, body: TranscriptPatchRequest) {
  return requestJson<{
    applied: boolean;
    suggestionsOnly: boolean;
    revisionId: string | null;
    issues: Array<{
      code: string;
      message: string;
      severity: "INFO" | "WARN" | "ERROR";
    }>;
  }>(`/api/projects-v2/${projectV2Id}/transcript`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function startRender(projectIdOrV2Id: string) {
  return requestJson<{ renderJob: { id: string; status: string; progress: number } }>(`/api/projects/${projectIdOrV2Id}/render`, {
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
