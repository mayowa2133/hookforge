export const queueNames = {
  renderProject: "render-project",
  ingest: "ingest",
  transcribe: "transcribe",
  captionStyle: "caption-style",
  translate: "translate",
  dubLipSync: "dub-lipsync",
  aiEdit: "ai-edit",
  aiGenerate: "ai-generate",
  renderPreview: "render-preview",
  renderFinal: "render-final",
  notify: "notify",
  billingMeter: "billing-meter"
} as const;

export type QueueName = (typeof queueNames)[keyof typeof queueNames];
