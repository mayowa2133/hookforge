import { TemplateSlotSchemaJson, type TemplateSlotSchemaJsonType } from "./template-schema";

export type TemplateDefinition = {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  slotSchema: TemplateSlotSchemaJsonType;
};

const phaseOneOptionalSlots: TemplateSlotSchemaJsonType["slots"] = [
  {
    key: "overlay_media",
    label: "Overlay Media (Optional)",
    kinds: ["VIDEO", "IMAGE"],
    required: false,
    helpText: "Optional extra visual to place with timeline transform controls."
  },
  {
    key: "voiceover",
    label: "Voiceover Track (Optional)",
    kinds: ["AUDIO"],
    required: false,
    helpText: "Upload a voiceover track for the multi-audio timeline."
  },
  {
    key: "music",
    label: "Music Track (Optional)",
    kinds: ["AUDIO"],
    required: false,
    helpText: "Upload royalty-safe music or use bundled audio clips."
  },
  {
    key: "sfx",
    label: "SFX Track (Optional)",
    kinds: ["AUDIO"],
    required: false,
    helpText: "Upload your own SFX track or add bundled SFX from the editor."
  }
];

const rawTemplates: TemplateDefinition[] = [
  {
    slug: "green-screen-commentator",
    name: "Green Screen Commentator",
    description: "Commentate over any background with creator-first framing.",
    tags: ["commentary", "explainer", "news"],
    slotSchema: {
      previewImage: "/demo-assets/template-green-screen.svg",
      slots: [
        {
          key: "background",
          label: "Background",
          kinds: ["IMAGE", "VIDEO"],
          required: true,
          helpText: "Article screenshot, slide, or screen recording."
        },
        {
          key: "foreground",
          label: "Talking Head",
          kinds: ["VIDEO"],
          required: true,
          minDurationSec: 3,
          helpText: "Your camera take. Keep face in center-left for best layout."
        }
      ],
      controls: [
        {
          key: "blurBackground",
          label: "Blur background",
          type: "boolean",
          defaultValue: true,
          helpText: "Adds subtle depth behind your face cam."
        },
        {
          key: "foregroundCornerRadius",
          label: "Foreground corner radius",
          type: "number",
          defaultValue: 28,
          min: 0,
          max: 64,
          step: 2
        },
        {
          key: "captionText",
          label: "Caption",
          type: "text",
          defaultValue: ""
        },
        {
          key: "subjectIsolation",
          label: "Background cleanup (no green screen)",
          type: "boolean",
          defaultValue: true,
          helpText: "Experimental static-background suppression applied during final render."
        },
        {
          key: "subjectIsolationMode",
          label: "Cleanup style",
          type: "select",
          defaultValue: "blur",
          options: [
            { label: "Blur + dim", value: "blur" },
            { label: "Solid black", value: "black" }
          ]
        },
        {
          key: "subjectIsolationSimilarity",
          label: "Cleanup sensitivity",
          type: "number",
          defaultValue: 0.25,
          min: 0.05,
          max: 0.6,
          step: 0.01,
          helpText: "Higher values remove more background but may trim moving edges."
        },
        {
          key: "subjectIsolationBlend",
          label: "Edge smoothing",
          type: "number",
          defaultValue: 0.08,
          min: 0,
          max: 0.3,
          step: 0.01
        }
      ],
      recipeCard: {
        filmingTips: [
          "Record talking head in vertical 9:16 at eye level.",
          "Use even lighting and keep shoulders visible.",
          "Speak in short punchy sentences with pauses every 4-6 seconds."
        ],
        structure: [
          "0-2s: Hook with claim",
          "2-15s: Explain context over background",
          "15s+: CTA or takeaway"
        ],
        caution: [
          "Background cleanup works best with static camera and consistent lighting.",
          "Templates are structural blueprints; upload only assets you own or are permitted to use."
        ]
      }
    }
  },
  {
    slug: "tweet-comment-popup-reply",
    name: "Tweet/Comment Pop-up Reply",
    description: "Respond to a post with a timed overlay and reaction delivery.",
    tags: ["reply", "social", "debate"],
    slotSchema: {
      previewImage: "/demo-assets/template-tweet-reply.svg",
      slots: [
        {
          key: "main",
          label: "Main Talking Video",
          kinds: ["VIDEO"],
          required: true,
          minDurationSec: 3
        },
        {
          key: "overlay",
          label: "Tweet / Comment Image",
          kinds: ["IMAGE"],
          required: true,
          helpText: "Upload the screenshot you have permission to use."
        }
      ],
      controls: [
        {
          key: "overlayAppearSec",
          label: "Overlay appear time (sec)",
          type: "number",
          defaultValue: 1,
          min: 0,
          max: 60,
          step: 0.1
        },
        {
          key: "animation",
          label: "Animation",
          type: "select",
          defaultValue: "pop",
          options: [
            { label: "Pop", value: "pop" },
            { label: "Slide up", value: "slide-up" }
          ]
        },
        {
          key: "notificationSfx",
          label: "Notification SFX",
          type: "boolean",
          defaultValue: false
        }
      ],
      recipeCard: {
        filmingTips: [
          "Pause briefly right before the overlay appears.",
          "Keep reaction authentic and concise.",
          "Leave top-center area visually clean for the overlay."
        ],
        structure: [
          "0-1s: Statement",
          "1-3s: Overlay appears",
          "3s+: Breakdown and opinion"
        ],
        caution: ["Only use screenshots and comments you have rights to share."]
      }
    }
  },
  {
    slug: "three-beat-montage-intro-main-talk",
    name: "3-Beat Montage Intro + Main Talk",
    description: "Three quick visual hits before your core explanation starts.",
    tags: ["montage", "story", "high-energy"],
    slotSchema: {
      previewImage: "/demo-assets/template-montage.svg",
      slots: [
        {
          key: "montage_1",
          label: "Montage Asset 1",
          kinds: ["VIDEO", "IMAGE"],
          required: true
        },
        {
          key: "montage_2",
          label: "Montage Asset 2",
          kinds: ["VIDEO", "IMAGE"],
          required: true
        },
        {
          key: "montage_3",
          label: "Montage Asset 3",
          kinds: ["VIDEO", "IMAGE"],
          required: true
        },
        {
          key: "main",
          label: "Main Talking Video",
          kinds: ["VIDEO"],
          required: true,
          minDurationSec: 3
        }
      ],
      controls: [
        {
          key: "beatDurationSec",
          label: "Beat duration (sec)",
          type: "number",
          defaultValue: 0.5,
          min: 0.4,
          max: 0.7,
          step: 0.05
        },
        {
          key: "includeBoomSfx",
          label: "Include boom SFX",
          type: "boolean",
          defaultValue: true
        }
      ],
      recipeCard: {
        filmingTips: [
          "Pick three visuals that escalate in tension.",
          "Keep each montage frame high-contrast.",
          "Start speaking immediately after beat three."
        ],
        structure: [
          "Beat 1: Problem",
          "Beat 2: Stakes",
          "Beat 3: Promise",
          "Main: Deliver value"
        ],
        caution: []
      }
    }
  },
  {
    slug: "split-screen-reaction",
    name: "Split-screen Reaction",
    description: "Top/bottom duet format for reactions and breakdowns.",
    tags: ["reaction", "duet", "analysis"],
    slotSchema: {
      previewImage: "/demo-assets/template-split-screen.svg",
      slots: [
        {
          key: "top",
          label: "Top Video",
          kinds: ["VIDEO"],
          required: true
        },
        {
          key: "bottom",
          label: "Bottom Reaction Video",
          kinds: ["VIDEO"],
          required: true
        }
      ],
      controls: [
        {
          key: "showBorder",
          label: "Show separator border",
          type: "boolean",
          defaultValue: true
        },
        {
          key: "topVolume",
          label: "Top audio volume",
          type: "number",
          defaultValue: 1,
          min: 0,
          max: 1,
          step: 0.05
        },
        {
          key: "bottomVolume",
          label: "Bottom audio volume",
          type: "number",
          defaultValue: 0.3,
          min: 0,
          max: 1,
          step: 0.05
        }
      ],
      recipeCard: {
        filmingTips: [
          "Keep both videos aligned to center.",
          "Use clear reaction moments in the lower clip.",
          "Avoid hard cuts in the first 2 seconds."
        ],
        structure: [
          "Top drives context",
          "Bottom drives emotion",
          "Final seconds summarize your stance"
        ],
        caution: []
      }
    }
  },
  {
    slug: "fake-facetime-incoming-call",
    name: "Fake FaceTime / Incoming Call Opener",
    description: "Open with a call screen to pattern-break and create curiosity.",
    tags: ["opener", "pattern-interrupt", "story"],
    slotSchema: {
      previewImage: "/demo-assets/template-facetime.svg",
      slots: [
        {
          key: "caller_photo",
          label: "Caller Photo",
          kinds: ["IMAGE"],
          required: true
        },
        {
          key: "main",
          label: "Main Video",
          kinds: ["VIDEO"],
          required: true,
          minDurationSec: 3
        }
      ],
      controls: [
        {
          key: "callerName",
          label: "Caller name",
          type: "text",
          defaultValue: "Creator Hotline"
        },
        {
          key: "ringDurationSec",
          label: "Ring duration (sec)",
          type: "number",
          defaultValue: 2,
          min: 1,
          max: 5,
          step: 0.1
        }
      ],
      recipeCard: {
        filmingTips: [
          "Use a recognizable caller label to increase intrigue.",
          "Start your main clip with immediate payoff.",
          "Keep ring intro under 3 seconds for retention."
        ],
        structure: [
          "0-2s: Incoming call screen",
          "2s+: Hard cut into narrative"
        ],
        caution: ["Use generic UI styling to avoid brand imitation risk."]
      }
    }
  }
];

export const templateCatalog: TemplateDefinition[] = rawTemplates.map((template) => {
  const parsed = TemplateSlotSchemaJson.parse(template.slotSchema);
  const existingKeys = new Set(parsed.slots.map((slot) => slot.key));

  const withPhaseOneSlots = [
    ...parsed.slots,
    ...phaseOneOptionalSlots.filter((slot) => !existingKeys.has(slot.key))
  ];

  return {
    ...template,
    slotSchema: {
      ...parsed,
      slots: withPhaseOneSlots
    }
  };
});

export function getTemplateDefinition(slug: string): TemplateDefinition | undefined {
  return templateCatalog.find((template) => template.slug === slug);
}
