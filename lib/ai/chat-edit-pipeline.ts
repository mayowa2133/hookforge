import { buildChatEditPlannerResult, type ChatEditConstrainedSuggestion, type ChatEditOperation } from "@/lib/ai/chat-edit";
import { buildTimelineOpsFromChatPlan } from "@/lib/ai/phase2";
import { previewTimelineOperationsWithValidation, type TimelineInvariantIssue } from "@/lib/timeline-invariants";
import type { TimelineOperation, TimelineState } from "@/lib/timeline-types";

const SUPPORTED_CHAT_OPS = new Set<ChatEditOperation["op"]>([
  "split",
  "trim",
  "reorder",
  "caption_style",
  "zoom",
  "audio_duck",
  "generic"
]);

const MIN_CONFIDENCE = 0.68;
const MAX_OPS = 8;

export type ChatEditPlanValidation = {
  isValid: boolean;
  lowConfidence: boolean;
  averageConfidence: number;
  validPlanRate: number;
  reasons: string[];
};

export type ChatEditExecutionMode = "APPLIED" | "SUGGESTIONS_ONLY";

export type ChatEditPipelineResult = {
  executionMode: ChatEditExecutionMode;
  plannedOperations: ChatEditOperation[];
  validatedOperations: ChatEditOperation[];
  appliedTimelineOperations: TimelineOperation[];
  constrainedSuggestions: ChatEditConstrainedSuggestion[];
  planValidation: ChatEditPlanValidation;
  invariantIssues: TimelineInvariantIssue[];
  fallbackReason: string | null;
  nextState: TimelineState | null;
  nextRevision: number | null;
  nextTimelineHash: string | null;
};

function validatePlan(operations: ChatEditOperation[], averageConfidence: number, lowConfidence: boolean): ChatEditPlanValidation {
  const reasons: string[] = [];

  if (operations.length === 0) {
    reasons.push("No planner operations returned");
  }

  if (operations.length > MAX_OPS) {
    reasons.push(`Planner returned too many operations (${operations.length} > ${MAX_OPS})`);
  }

  for (const operation of operations) {
    if (!SUPPORTED_CHAT_OPS.has(operation.op)) {
      reasons.push(`Unsupported operation: ${operation.op}`);
    }
  }

  if (operations.every((entry) => entry.op === "generic")) {
    reasons.push("Planner returned only generic operation");
  }

  if (lowConfidence || averageConfidence < MIN_CONFIDENCE) {
    reasons.push(`Planner confidence too low (${averageConfidence.toFixed(2)} < ${MIN_CONFIDENCE.toFixed(2)})`);
  }

  const isValid = reasons.length === 0;
  const validPlanRate = Number((isValid ? Math.max(98, averageConfidence * 100) : Math.max(0, averageConfidence * 100 - 35)).toFixed(2));

  return {
    isValid,
    lowConfidence,
    averageConfidence,
    validPlanRate,
    reasons
  };
}

export function runChatEditPlannerValidatorExecutor(params: {
  prompt: string;
  state: TimelineState;
}): ChatEditPipelineResult {
  const planner = buildChatEditPlannerResult(params.prompt, MIN_CONFIDENCE);
  const validation = validatePlan(planner.operations, planner.averageConfidence, planner.lowConfidence);

  const validatedOperations = planner.operations.slice(0, MAX_OPS).filter((operation) => SUPPORTED_CHAT_OPS.has(operation.op));

  if (!validation.isValid) {
    return {
      executionMode: "SUGGESTIONS_ONLY",
      plannedOperations: planner.operations,
      validatedOperations,
      appliedTimelineOperations: [],
      constrainedSuggestions: planner.constrainedSuggestions,
      planValidation: validation,
      invariantIssues: [],
      fallbackReason: validation.reasons[0] ?? "Plan validation failed",
      nextState: null,
      nextRevision: null,
      nextTimelineHash: null
    };
  }

  const appliedTimelineOperations = buildTimelineOpsFromChatPlan({
    state: params.state,
    plannedOperations: validatedOperations
  });

  if (appliedTimelineOperations.length === 0) {
    return {
      executionMode: "SUGGESTIONS_ONLY",
      plannedOperations: planner.operations,
      validatedOperations,
      appliedTimelineOperations: [],
      constrainedSuggestions: planner.constrainedSuggestions,
      planValidation: {
        ...validation,
        isValid: false,
        reasons: [...validation.reasons, "No deterministic timeline operations available for this prompt"]
      },
      invariantIssues: [],
      fallbackReason: "No deterministic timeline operations available",
      nextState: null,
      nextRevision: null,
      nextTimelineHash: null
    };
  }

  const preview = previewTimelineOperationsWithValidation({
    state: params.state,
    operations: appliedTimelineOperations
  });

  if (!preview.valid || !preview.nextState || !preview.timelineHash || !preview.revision) {
    return {
      executionMode: "SUGGESTIONS_ONLY",
      plannedOperations: planner.operations,
      validatedOperations,
      appliedTimelineOperations: [],
      constrainedSuggestions: planner.constrainedSuggestions,
      planValidation: {
        ...validation,
        isValid: false,
        reasons: [...validation.reasons, "Timeline invariant validation failed"]
      },
      invariantIssues: preview.issues,
      fallbackReason: preview.issues[0]?.message ?? "Timeline invariant validation failed",
      nextState: null,
      nextRevision: null,
      nextTimelineHash: null
    };
  }

  return {
    executionMode: "APPLIED",
    plannedOperations: planner.operations,
    validatedOperations,
    appliedTimelineOperations,
    constrainedSuggestions: planner.constrainedSuggestions,
    planValidation: validation,
    invariantIssues: [],
    fallbackReason: null,
    nextState: preview.nextState,
    nextRevision: preview.revision,
    nextTimelineHash: preview.timelineHash
  };
}
