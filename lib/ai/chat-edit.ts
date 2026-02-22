export type ChatEditOperation = {
  op: "split" | "trim" | "reorder" | "caption_style" | "zoom" | "audio_duck" | "generic";
  target?: string;
  value?: string | number | boolean;
  confidence: number;
};

export type ChatEditConstrainedSuggestion = {
  id: string;
  title: string;
  prompt: string;
  reason: string;
};

export type ChatEditPlannerResult = {
  operations: ChatEditOperation[];
  averageConfidence: number;
  lowConfidence: boolean;
  constrainedSuggestions: ChatEditConstrainedSuggestion[];
};

const DEFAULT_CONFIDENCE_FLOOR = 0.68;

function includesAny(prompt: string, words: string[]) {
  return words.some((word) => prompt.includes(word));
}

function buildConstrainedSuggestions(prompt: string, operations: ChatEditOperation[]) {
  const loweredPrompt = prompt.toLowerCase();
  const suggestions: ChatEditConstrainedSuggestion[] = [];

  if (operations.some((entry) => entry.op === "split" || entry.op === "trim")) {
    suggestions.push({
      id: "timing-tighten",
      title: "Tighten timing",
      prompt: "Split the intro and trim 120ms from both ends of the first clip",
      reason: "Keeps pacing edits deterministic"
    });
  }

  if (operations.some((entry) => entry.op === "caption_style") || loweredPrompt.includes("caption")) {
    suggestions.push({
      id: "caption-style-bold",
      title: "Apply bold captions",
      prompt: "Apply a bold caption style to the first caption clip",
      reason: "Caption style updates are low-risk and reversible"
    });
  }

  if (operations.some((entry) => entry.op === "audio_duck") || loweredPrompt.includes("audio") || loweredPrompt.includes("music")) {
    suggestions.push({
      id: "audio-duck",
      title: "Reduce background audio",
      prompt: "Lower non-primary audio track volume to 0.62",
      reason: "Improves vocal clarity without destructive edits"
    });
  }

  if (suggestions.length === 0) {
    suggestions.push(
      {
        id: "safe-split",
        title: "Split intro",
        prompt: "Split the first clip at the midpoint",
        reason: "Deterministic timeline operation"
      },
      {
        id: "safe-trim",
        title: "Trim dead air",
        prompt: "Trim 120ms from start and end of the first clip",
        reason: "Constrained and reversible"
      },
      {
        id: "safe-caption",
        title: "Style captions",
        prompt: "Apply bold caption style with subtle background opacity",
        reason: "Visual-only change with minimal risk"
      }
    );
  }

  return suggestions.slice(0, 3);
}

function buildOperations(promptInput: string): ChatEditOperation[] {
  const prompt = promptInput.toLowerCase();
  const operations: ChatEditOperation[] = [];

  if (includesAny(prompt, ["split", "cut", "chop"])) {
    operations.push({ op: "split", target: "timeline", confidence: 0.79 });
  }

  if (includesAny(prompt, ["trim", "shorten", "remove pause", "tighten"])) {
    operations.push({ op: "trim", target: "timeline", confidence: 0.8 });
  }

  if (includesAny(prompt, ["caption", "subtitles", "subtitle"])) {
    operations.push({ op: "caption_style", target: "captions", confidence: 0.84 });
  }

  if (includesAny(prompt, ["zoom", "punch in", "close up"])) {
    operations.push({ op: "zoom", target: "video-track", confidence: 0.74 });
  }

  if (includesAny(prompt, ["reorder", "move", "swap"])) {
    operations.push({ op: "reorder", target: "clips", confidence: 0.72 });
  }

  if (includesAny(prompt, ["music lower", "duck", "voice clearer", "reduce music"])) {
    operations.push({ op: "audio_duck", target: "audio-track", confidence: 0.76 });
  }

  if (operations.length === 0) {
    operations.push({
      op: "generic",
      target: "timeline",
      value: "manual-review",
      confidence: 0.55
    });
  }

  return operations;
}

export function buildChatEditPlannerResult(promptInput: string, confidenceFloor = DEFAULT_CONFIDENCE_FLOOR): ChatEditPlannerResult {
  const operations = buildOperations(promptInput);
  const averageConfidence = operations.reduce((sum, entry) => sum + entry.confidence, 0) / operations.length;
  const lowConfidence = averageConfidence < confidenceFloor || operations.some((entry) => entry.op === "generic");

  return {
    operations,
    averageConfidence,
    lowConfidence,
    constrainedSuggestions: buildConstrainedSuggestions(promptInput, operations)
  };
}

// Backwards-compatible helper kept for existing callers and tests.
export function buildChatEditPlan(promptInput: string): ChatEditOperation[] {
  return buildChatEditPlannerResult(promptInput).operations;
}
