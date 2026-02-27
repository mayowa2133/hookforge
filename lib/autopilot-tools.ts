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
  "speaker_cleanup_chaptering",
  "transcript_cleanup",
  "extract_highlights",
  "generate_social_assets",
  "title_description_suggestions",
  "remove_retakes_word_gaps"
] as const;

export type AutopilotPlannerPack = (typeof AUTOPILOT_PLANNER_PACKS)[number];
export type AutopilotMacroId = (typeof AUTOPILOT_MACRO_IDS)[number];
export const UNDERLORD_COMMAND_FAMILIES = [
  "transcript_cleanup",
  "pacing",
  "highlight_clips",
  "chaptering",
  "social_posts",
  "metadata_generation",
  "retake_cleanup",
  "audio_polish",
  "publish_prep"
] as const;
export type UnderlordCommandFamily = (typeof UNDERLORD_COMMAND_FAMILIES)[number];
export const UnderlordCommandFamilySchema = z.enum(UNDERLORD_COMMAND_FAMILIES);

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

export type AutopilotQualityDeltaPreview = {
  commandFamily: UnderlordCommandFamily;
  estimatedScoreDelta: number;
  confidence: number;
  rationale: string[];
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
  commandFamily?: UnderlordCommandFamily | null;
};

type ResolvePromptOutput = {
  originalPrompt: string;
  resolvedPrompt: string;
  plannerPack: AutopilotPlannerPack;
  macroId: AutopilotMacroId | null;
  macroLabel: string | null;
  macroArgs: AutopilotMacroArgs | null;
  commandFamily: UnderlordCommandFamily;
  qualityDeltaPreview: AutopilotQualityDeltaPreview;
};

const PACK_INSTRUCTIONS: Record<AutopilotPlannerPack, string> = {
  timeline: "Focus on deterministic timeline edits (split/trim/reorder/pace).",
  transcript: "Prioritize transcript-safe edits, speaker consistency, and readability.",
  captions: "Prioritize caption clarity, styling consistency, and timing-safe updates.",
  audio: "Prioritize filler cleanup and audio clarity without destructive drift.",
  publishing: "Prioritize publish readiness: pacing polish, clarity, and CTA-safe finalization notes."
};

const MACRO_DEFINITIONS: Record<AutopilotMacroId, {
  label: string;
  toPrompt: (args: AutopilotMacroArgs) => string;
  plannerPack: AutopilotPlannerPack;
  commandFamily: UnderlordCommandFamily;
}> = {
  tighten_pacing: {
    label: "Tighten Pacing",
    plannerPack: "timeline",
    commandFamily: "pacing",
    toPrompt: () => "Tighten pacing: split weak intro beats, trim dead air, and keep the first hook concise."
  },
  remove_filler_normalize_audio: {
    label: "Remove Filler + Normalize Audio",
    plannerPack: "audio",
    commandFamily: "audio_polish",
    toPrompt: () => "Remove filler phrases and improve voice clarity with loudness normalization near -14 LUFS."
  },
  social_cut_from_range: {
    label: "Social Cut From Range",
    plannerPack: "timeline",
    commandFamily: "highlight_clips",
    toPrompt: (args) => {
      const startMs = Math.max(0, Math.floor(args.startMs ?? 0));
      const endMs = Math.max(startMs + 1000, Math.floor(args.endMs ?? Math.max(30000, startMs + 1000)));
      return `Create a social-ready cut focused on ${startMs}-${endMs}ms, preserving hook and CTA continuity.`;
    }
  },
  speaker_cleanup_chaptering: {
    label: "Speaker Cleanup + Chaptering",
    plannerPack: "transcript",
    commandFamily: "chaptering",
    toPrompt: (args) => {
      const speaker = (args.speakerLabel ?? "primary host").trim();
      const chapterCount = Math.max(2, Math.floor(args.chapterCount ?? 4));
      return `Normalize speaker labels around ${speaker} and propose ${chapterCount} concise chapter cues for major topic shifts.`;
    }
  },
  transcript_cleanup: {
    label: "Transcript Cleanup",
    plannerPack: "transcript",
    commandFamily: "transcript_cleanup",
    toPrompt: () => "Clean transcript grammar and punctuation while preserving original meaning and speaker intent."
  },
  extract_highlights: {
    label: "Extract Highlights",
    plannerPack: "timeline",
    commandFamily: "highlight_clips",
    toPrompt: () => "Find the strongest moments and propose 3 concise highlight clips with hook-first ordering."
  },
  generate_social_assets: {
    label: "Generate Social Assets",
    plannerPack: "publishing",
    commandFamily: "social_posts",
    toPrompt: () => "Generate platform-ready social post copy and CTA variants aligned to the final edit."
  },
  title_description_suggestions: {
    label: "Title + Description Suggestions",
    plannerPack: "publishing",
    commandFamily: "metadata_generation",
    toPrompt: () => "Suggest 5 titles and 3 descriptions optimized for clarity, retention, and discoverability."
  },
  remove_retakes_word_gaps: {
    label: "Remove Retakes + Word Gaps",
    plannerPack: "audio",
    commandFamily: "retake_cleanup",
    toPrompt: () => "Detect likely retakes and long word gaps, then propose safe cuts with transcript alignment."
  }
};

const PLANNER_PACK_FAMILY_MAP: Record<AutopilotPlannerPack, UnderlordCommandFamily> = {
  timeline: "pacing",
  transcript: "transcript_cleanup",
  captions: "transcript_cleanup",
  audio: "audio_polish",
  publishing: "publish_prep"
};

const COMMAND_FAMILY_PROMPTS: Record<UnderlordCommandFamily, {
  label: string;
  plannerPack: AutopilotPlannerPack;
  toPrompt: (args: AutopilotMacroArgs) => string;
}> = {
  transcript_cleanup: {
    label: "Transcript Cleanup",
    plannerPack: "transcript",
    toPrompt: () => "Clean transcript grammar, punctuation, and filler artifacts while preserving exact meaning and speaker intent."
  },
  pacing: {
    label: "Tighten Pacing",
    plannerPack: "timeline",
    toPrompt: () => "Tighten pacing by splitting weak beats and trimming dead air while preserving hook continuity."
  },
  highlight_clips: {
    label: "Extract Highlight Clips",
    plannerPack: "timeline",
    toPrompt: () => "Extract highlight-ready clip moments and label them clearly for social repurposing."
  },
  chaptering: {
    label: "Generate Chapters",
    plannerPack: "transcript",
    toPrompt: (args) => {
      const chapterCount = Math.max(2, Math.floor(args.chapterCount ?? 4));
      return `Generate ${chapterCount} concise chapter markers and align labels with transcript topic shifts.`;
    }
  },
  social_posts: {
    label: "Generate Social Assets",
    plannerPack: "publishing",
    toPrompt: () => "Generate social copy variants and CTA framing aligned to the edited timeline."
  },
  metadata_generation: {
    label: "Generate Titles + Descriptions",
    plannerPack: "publishing",
    toPrompt: () => "Generate channel-ready title and description variants with discoverability-safe phrasing."
  },
  retake_cleanup: {
    label: "Retake Cleanup",
    plannerPack: "audio",
    toPrompt: () => "Detect likely retake segments and remove long word-gap artifacts with conservative cuts."
  },
  audio_polish: {
    label: "Audio Polish",
    plannerPack: "audio",
    toPrompt: () => "Remove filler speech and normalize voice clarity while preserving natural cadence."
  },
  publish_prep: {
    label: "Publish Prep",
    plannerPack: "publishing",
    toPrompt: () => "Prepare final publish settings, export readiness, and end-card clarity adjustments."
  }
};

export const UNDERLORD_COMMAND_CATALOG = (UNDERLORD_COMMAND_FAMILIES as readonly UnderlordCommandFamily[]).map((family) => ({
  id: family,
  label: COMMAND_FAMILY_PROMPTS[family].label,
  plannerPack: COMMAND_FAMILY_PROMPTS[family].plannerPack,
  defaultPrompt: COMMAND_FAMILY_PROMPTS[family].toPrompt({}),
  macroAliases: (Object.entries(MACRO_DEFINITIONS) as Array<[AutopilotMacroId, (typeof MACRO_DEFINITIONS)[AutopilotMacroId]]>)
    .filter(([, entry]) => entry.commandFamily === family)
    .map(([macroId]) => macroId)
}));

const FAMILY_DELTA_BASE: Record<UnderlordCommandFamily, number> = {
  transcript_cleanup: 5.5,
  pacing: 7.2,
  highlight_clips: 8.1,
  chaptering: 6.2,
  social_posts: 4.4,
  metadata_generation: 4.1,
  retake_cleanup: 6.8,
  audio_polish: 7.4,
  publish_prep: 5.1
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

function inferCommandFamily(params: {
  prompt: string;
  plannerPack: AutopilotPlannerPack;
  macroId: AutopilotMacroId | null;
}) {
  if (params.macroId) {
    return MACRO_DEFINITIONS[params.macroId].commandFamily;
  }
  const lowered = params.prompt.toLowerCase();
  if (lowered.includes("chapter")) return "chaptering";
  if (lowered.includes("highlight") || lowered.includes("clip")) return "highlight_clips";
  if (lowered.includes("title") || lowered.includes("description")) return "metadata_generation";
  if (lowered.includes("retake") || lowered.includes("gap")) return "retake_cleanup";
  if (lowered.includes("social")) return "social_posts";
  if (lowered.includes("pacing")) return "pacing";
  if (lowered.includes("audio") || lowered.includes("filler")) return "audio_polish";
  if (lowered.includes("transcript")) return "transcript_cleanup";
  return PLANNER_PACK_FAMILY_MAP[params.plannerPack];
}

function buildQualityDeltaPreview(params: {
  commandFamily: UnderlordCommandFamily;
  hasMacro: boolean;
  prompt: string;
}): AutopilotQualityDeltaPreview {
  const base = FAMILY_DELTA_BASE[params.commandFamily];
  const macroBoost = params.hasMacro ? 0.8 : 0;
  const promptLengthBoost = Math.min(1.2, Math.max(0, params.prompt.length / 220));
  const estimatedScoreDelta = Number(Math.min(15, (base + macroBoost + promptLengthBoost)).toFixed(2));
  const confidence = Number((params.hasMacro ? 0.86 : 0.73).toFixed(2));
  const rationale = [
    `Base uplift for ${params.commandFamily.replaceAll("_", " ")} actions.`,
    params.hasMacro
      ? "Macro selected: deterministic intent improves planner precision."
      : "Freeform prompt selected: planner confidence depends on prompt specificity."
  ];
  return {
    commandFamily: params.commandFamily,
    estimatedScoreDelta,
    confidence,
    rationale
  };
}

export function resolveAutopilotPrompt(input: ResolvePromptInput): ResolvePromptOutput {
  const prompt = normalizePrompt(input.prompt);
  if (!prompt && !input.macroId && !input.commandFamily) {
    throw new Error("Autopilot requires prompt, macroId, or commandFamily.");
  }

  if (input.macroId) {
    const definition = MACRO_DEFINITIONS[input.macroId];
    const macroArgs = normalizeMacroArgs(input.macroArgs);
    const plannerPack = normalizePack(input.plannerPack, definition.plannerPack);
    const macroPrompt = definition.toPrompt(macroArgs ?? {});
    const resolvedPrompt = `[Planner Pack: ${plannerPack}] ${PACK_INSTRUCTIONS[plannerPack]} ${macroPrompt}`;
    const commandFamily = definition.commandFamily;
    const qualityDeltaPreview = buildQualityDeltaPreview({
      commandFamily,
      hasMacro: true,
      prompt: macroPrompt
    });
    return {
      originalPrompt: prompt || definition.label,
      resolvedPrompt,
      plannerPack,
      macroId: input.macroId,
      macroLabel: definition.label,
      macroArgs,
      commandFamily,
      qualityDeltaPreview
    };
  }
  const macroArgs = normalizeMacroArgs(input.macroArgs);
  const familyFromInput = input.commandFamily ?? null;
  const fallbackPack = familyFromInput ? COMMAND_FAMILY_PROMPTS[familyFromInput].plannerPack : "timeline";
  const plannerPack = normalizePack(input.plannerPack, fallbackPack);
  const commandFamily = familyFromInput ?? inferCommandFamily({
    prompt: prompt || COMMAND_FAMILY_PROMPTS[PLANNER_PACK_FAMILY_MAP[plannerPack]].toPrompt(macroArgs ?? {}),
    plannerPack,
    macroId: null
  });
  const familyPrompt = COMMAND_FAMILY_PROMPTS[commandFamily].toPrompt(macroArgs ?? {});
  const effectivePrompt = prompt || familyPrompt;
  const resolvedPrompt = `[Planner Pack: ${plannerPack}] ${PACK_INSTRUCTIONS[plannerPack]} ${effectivePrompt}`;
  const qualityDeltaPreview = buildQualityDeltaPreview({
    commandFamily,
    hasMacro: false,
    prompt: effectivePrompt
  });
  return {
    originalPrompt: effectivePrompt,
    resolvedPrompt,
    plannerPack,
    macroId: null,
    macroLabel: null,
    macroArgs,
    commandFamily,
    qualityDeltaPreview
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
