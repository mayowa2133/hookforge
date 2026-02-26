import { z } from "zod";

export const AUTOPILOT_PLANNER_PACKS = [
  "timeline",
  "transcript",
  "captions",
  "audio",
  "publishing"
] as const;

export const AUTOPILOT_MACRO_IDS = [
  "tighten_pacing",
  "remove_filler_normalize_audio",
  "social_cut_from_range",
  "speaker_cleanup_chaptering"
] as const;

export type AutopilotPlannerPack = (typeof AUTOPILOT_PLANNER_PACKS)[number];
export type AutopilotMacroId = (typeof AUTOPILOT_MACRO_IDS)[number];

export type AutopilotDiffItem = {
  id: string;
  type: "operation" | "note";
  label: string;
  before?: string;
  after?: string;
  severity?: "INFO" | "WARN" | "ERROR";
  operationIndex?: number;
};

export type AutopilotDiffGroup = {
  group: "timeline" | "transcript" | "captions" | "audio" | "publishing";
  title: string;
  summary: string;
  items: AutopilotDiffItem[];
};

export type AutopilotMacroArgs = {
  startMs?: number;
  endMs?: number;
  speakerLabel?: string;
  chapterCount?: number;
};

export const AutopilotPlannerPackSchema = z.enum(AUTOPILOT_PLANNER_PACKS);
export const AutopilotMacroIdSchema = z.enum(AUTOPILOT_MACRO_IDS);
export const AutopilotMacroArgsSchema = z.object({
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().min(1).optional(),
  speakerLabel: z.string().trim().min(1).max(80).optional(),
  chapterCount: z.number().int().min(1).max(24).optional()
}).optional();

type ResolvePromptInput = {
  prompt?: string | null;
  plannerPack?: AutopilotPlannerPack | null;
  macroId?: AutopilotMacroId | null;
  macroArgs?: AutopilotMacroArgs | null;
};

type ResolvePromptOutput = {
  originalPrompt: string;
  resolvedPrompt: string;
  plannerPack: AutopilotPlannerPack;
  macroId: AutopilotMacroId | null;
  macroLabel: string | null;
  macroArgs: AutopilotMacroArgs | null;
};

const PACK_INSTRUCTIONS: Record<AutopilotPlannerPack, string> = {
  timeline: "Focus on deterministic timeline edits (split/trim/reorder/pace).",
  transcript: "Prioritize transcript-safe edits, speaker consistency, and readability.",
  captions: "Prioritize caption clarity, styling consistency, and timing-safe updates.",
  audio: "Prioritize filler cleanup and audio clarity without destructive drift.",
  publishing: "Prioritize publish readiness: pacing polish, clarity, and CTA-safe finalization notes."
};

const MACRO_DEFINITIONS: Record<AutopilotMacroId, { label: string; toPrompt: (args: AutopilotMacroArgs) => string; plannerPack: AutopilotPlannerPack }> = {
  tighten_pacing: {
    label: "Tighten Pacing",
    plannerPack: "timeline",
    toPrompt: () => "Tighten pacing: split weak intro beats, trim dead air, and keep the first hook concise."
  },
  remove_filler_normalize_audio: {
    label: "Remove Filler + Normalize Audio",
    plannerPack: "audio",
    toPrompt: () => "Remove filler phrases and improve voice clarity with loudness normalization near -14 LUFS."
  },
  social_cut_from_range: {
    label: "Social Cut From Range",
    plannerPack: "timeline",
    toPrompt: (args) => {
      const startMs = Math.max(0, Math.floor(args.startMs ?? 0));
      const endMs = Math.max(startMs + 1000, Math.floor(args.endMs ?? Math.max(30000, startMs + 1000)));
      return `Create a social-ready cut focused on ${startMs}-${endMs}ms, preserving hook and CTA continuity.`;
    }
  },
  speaker_cleanup_chaptering: {
    label: "Speaker Cleanup + Chaptering",
    plannerPack: "transcript",
    toPrompt: (args) => {
      const speaker = (args.speakerLabel ?? "primary host").trim();
      const chapterCount = Math.max(2, Math.floor(args.chapterCount ?? 4));
      return `Normalize speaker labels around ${speaker} and propose ${chapterCount} concise chapter cues for major topic shifts.`;
    }
  }
};

function normalizePrompt(input: string | null | undefined) {
  return (input ?? "").trim().slice(0, 1000);
}

function normalizePack(input: AutopilotPlannerPack | null | undefined, fallback: AutopilotPlannerPack) {
  return input && AUTOPILOT_PLANNER_PACKS.includes(input) ? input : fallback;
}

function normalizeMacroArgs(input: AutopilotMacroArgs | null | undefined): AutopilotMacroArgs | null {
  if (!input) {
    return null;
  }
  return {
    startMs: typeof input.startMs === "number" ? Math.max(0, Math.floor(input.startMs)) : undefined,
    endMs: typeof input.endMs === "number" ? Math.max(1, Math.floor(input.endMs)) : undefined,
    speakerLabel: typeof input.speakerLabel === "string" ? input.speakerLabel.trim().slice(0, 80) : undefined,
    chapterCount: typeof input.chapterCount === "number" ? Math.max(1, Math.min(24, Math.floor(input.chapterCount))) : undefined
  };
}

export function resolveAutopilotPrompt(input: ResolvePromptInput): ResolvePromptOutput {
  const prompt = normalizePrompt(input.prompt);
  if (!prompt && !input.macroId) {
    throw new Error("Autopilot requires either prompt or macroId.");
  }

  if (input.macroId) {
    const definition = MACRO_DEFINITIONS[input.macroId];
    const macroArgs = normalizeMacroArgs(input.macroArgs);
    const plannerPack = normalizePack(input.plannerPack, definition.plannerPack);
    const macroPrompt = definition.toPrompt(macroArgs ?? {});
    const resolvedPrompt = `[Planner Pack: ${plannerPack}] ${PACK_INSTRUCTIONS[plannerPack]} ${macroPrompt}`;
    return {
      originalPrompt: prompt || definition.label,
      resolvedPrompt,
      plannerPack,
      macroId: input.macroId,
      macroLabel: definition.label,
      macroArgs
    };
  }

  const plannerPack = normalizePack(input.plannerPack, "timeline");
  const resolvedPrompt = `[Planner Pack: ${plannerPack}] ${PACK_INSTRUCTIONS[plannerPack]} ${prompt}`;
  return {
    originalPrompt: prompt,
    resolvedPrompt,
    plannerPack,
    macroId: null,
    macroLabel: null,
    macroArgs: null
  };
}

export function appendPublishingDiffGroup(params: {
  groups: AutopilotDiffGroup[];
  plannerPack: AutopilotPlannerPack;
  constrainedSuggestions: Array<{ title: string; prompt: string; reason: string }>;
}) {
  const existing = params.groups.some((group) => group.group === "publishing");
  if (existing) {
    return params.groups;
  }
  if (params.plannerPack !== "publishing") {
    return params.groups;
  }
  const items: AutopilotDiffItem[] = params.constrainedSuggestions.slice(0, 4).map((suggestion, index) => ({
    id: `publishing-note-${index + 1}`,
    type: "note",
    label: suggestion.title,
    after: suggestion.prompt,
    severity: "INFO"
  }));
  return [
    ...params.groups,
    {
      group: "publishing",
      title: "Publishing Prep",
      summary: items.length > 0 ? `${items.length} publish-readiness suggestion(s)` : "No publishing prep notes",
      items
    }
  ];
}

export function getTimelineOperationItemIds(groups: AutopilotDiffGroup[]) {
  return groups
    .find((group) => group.group === "timeline")
    ?.items.filter((item) => item.type === "operation")
    .map((item) => item.id) ?? [];
}

