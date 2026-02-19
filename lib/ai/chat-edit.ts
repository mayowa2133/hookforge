export type ChatEditOperation = {
  op: "split" | "trim" | "reorder" | "caption_style" | "zoom" | "audio_duck" | "generic";
  target?: string;
  value?: string | number | boolean;
  confidence: number;
};

function includesAny(prompt: string, words: string[]) {
  return words.some((word) => prompt.includes(word));
}

export function buildChatEditPlan(promptInput: string): ChatEditOperation[] {
  const prompt = promptInput.toLowerCase();
  const operations: ChatEditOperation[] = [];

  if (includesAny(prompt, ["split", "cut", "chop"])) {
    operations.push({ op: "split", target: "timeline", confidence: 0.77 });
  }

  if (includesAny(prompt, ["trim", "shorten", "remove pause", "tighten"])) {
    operations.push({ op: "trim", target: "timeline", confidence: 0.79 });
  }

  if (includesAny(prompt, ["caption", "subtitles", "subtitle"])) {
    operations.push({ op: "caption_style", target: "captions", confidence: 0.81 });
  }

  if (includesAny(prompt, ["zoom", "punch in", "close up"])) {
    operations.push({ op: "zoom", target: "video-track", confidence: 0.73 });
  }

  if (includesAny(prompt, ["reorder", "move", "swap"])) {
    operations.push({ op: "reorder", target: "clips", confidence: 0.71 });
  }

  if (includesAny(prompt, ["music lower", "duck", "voice clearer", "reduce music"])) {
    operations.push({ op: "audio_duck", target: "audio-track", confidence: 0.74 });
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
