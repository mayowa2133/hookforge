import type { ChatEditExecutionMode, ChatEditPlanValidation } from "@/lib/ai/chat-edit-pipeline";
import type { TimelineOperation } from "@/lib/timeline-types";

export type ChatSafetyMode = "APPLIED" | "APPLY_WITH_CONFIRM" | "SUGGESTIONS_ONLY";

export type ChatConfidenceRationale = {
  averageConfidence: number;
  validPlanRate: number;
  lowConfidence: boolean;
  reasons: string[];
  fallbackReason: string | null;
};

export type ChatPlanOperationDecision = {
  itemId: string;
  accepted: boolean;
};

export type RevisionGraphNode = {
  revisionId: string;
  revisionNumber: number;
  source: string;
  summary: string;
  createdAt: string;
  isCurrent: boolean;
};

export type RevisionGraphEdge = {
  fromRevisionId: string;
  toRevisionId: string;
  relation: "NEXT";
  reason: string;
};

type RevisionLike = {
  id: string;
  revisionNumber: number;
  operations: unknown;
  createdAt: Date | string;
};

type TimelineDiffItem = {
  id: string;
  operationIndex?: number;
};

function toNumber(input: unknown, fallback = 0) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function readSource(operations: unknown) {
  if (operations && typeof operations === "object" && "source" in (operations as Record<string, unknown>)) {
    const source = (operations as Record<string, unknown>).source;
    if (typeof source === "string" && source.trim().length > 0) {
      return source.trim();
    }
  }
  return "timeline_edit";
}

function readSummary(operations: unknown) {
  if (Array.isArray(operations)) {
    return operations.length > 0 ? `${operations.length} operation(s)` : "Empty operation set";
  }
  if (operations && typeof operations === "object") {
    const record = operations as Record<string, unknown>;
    if (typeof record.source === "string") {
      return record.source;
    }
  }
  return "timeline_update";
}

export function resolveChatSafetyMode(params: {
  executionMode: ChatEditExecutionMode;
  averageConfidence: number;
}): ChatSafetyMode {
  if (params.executionMode === "SUGGESTIONS_ONLY") {
    return "SUGGESTIONS_ONLY";
  }
  if (params.averageConfidence < 0.65) {
    return "SUGGESTIONS_ONLY";
  }
  if (params.averageConfidence < 0.85) {
    return "APPLY_WITH_CONFIRM";
  }
  return "APPLIED";
}

export function buildChatConfidenceRationale(
  validation: ChatEditPlanValidation,
  fallbackReason: string | null
): ChatConfidenceRationale {
  return {
    averageConfidence: Number(validation.averageConfidence.toFixed(4)),
    validPlanRate: Number(validation.validPlanRate.toFixed(2)),
    lowConfidence: validation.lowConfidence,
    reasons: validation.reasons,
    fallbackReason
  };
}

export function selectTimelineOperationsFromDecisions(params: {
  operations: TimelineOperation[];
  timelineItems: TimelineDiffItem[];
  decisions?: ChatPlanOperationDecision[];
}) {
  if (!params.decisions || params.decisions.length === 0) {
    return {
      selectedOperations: params.operations,
      selectedCount: params.operations.length,
      skippedCount: 0,
      unknownDecisionItemIds: [] as string[]
    };
  }

  const decisionByItem = new Map<string, boolean>();
  for (const decision of params.decisions) {
    decisionByItem.set(decision.itemId, decision.accepted);
  }

  const operationIndexByItem = new Map<string, number>();
  for (const item of params.timelineItems) {
    if (typeof item.operationIndex === "number" && item.operationIndex >= 0) {
      operationIndexByItem.set(item.id, item.operationIndex);
    }
  }

  const unknownDecisionItemIds: string[] = [];
  for (const itemId of decisionByItem.keys()) {
    if (!operationIndexByItem.has(itemId)) {
      unknownDecisionItemIds.push(itemId);
    }
  }

  const selectedIndexSet = new Set<number>();
  params.timelineItems.forEach((item, fallbackIndex) => {
    const opIndex = toNumber(item.operationIndex, fallbackIndex);
    const accepted = decisionByItem.has(item.id) ? decisionByItem.get(item.id) === true : true;
    if (accepted) {
      selectedIndexSet.add(opIndex);
    }
  });

  const selectedOperations = params.operations.filter((_, index) => selectedIndexSet.has(index));
  return {
    selectedOperations,
    selectedCount: selectedOperations.length,
    skippedCount: Math.max(0, params.operations.length - selectedOperations.length),
    unknownDecisionItemIds
  };
}

export function buildRevisionGraph(params: {
  revisions: RevisionLike[];
  currentRevisionId: string | null;
}) {
  const sorted = [...params.revisions].sort((a, b) => a.revisionNumber - b.revisionNumber);
  const nodes: RevisionGraphNode[] = sorted.map((revision) => ({
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    source: readSource(revision.operations),
    summary: readSummary(revision.operations),
    createdAt: new Date(revision.createdAt).toISOString(),
    isCurrent: params.currentRevisionId === revision.id
  }));

  const edges: RevisionGraphEdge[] = [];
  for (let index = 1; index < nodes.length; index += 1) {
    edges.push({
      fromRevisionId: nodes[index - 1].revisionId,
      toRevisionId: nodes[index].revisionId,
      relation: "NEXT",
      reason: nodes[index].source
    });
  }

  return {
    nodes,
    edges
  };
}
