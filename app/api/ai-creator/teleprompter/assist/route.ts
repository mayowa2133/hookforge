import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { sanitizeOverlayText } from "@/lib/sanitize";

export const runtime = "nodejs";

const AssistSchema = z.object({
  topic: z.string().min(3).max(160),
  tone: z.enum(["direct", "hype", "educational", "story"]).default("direct"),
  durationSec: z.number().min(10).max(180).default(45),
  callToAction: z.string().max(160).optional()
});

type AssistPayload = z.infer<typeof AssistSchema>;

const toneOpeners: Record<AssistPayload["tone"], string> = {
  direct: "Here is the point in plain language",
  hype: "This will change the way you post short-form content",
  educational: "Let me break this down step by step",
  story: "Quick story before we get tactical"
};

function buildScript(body: AssistPayload) {
  const topic = sanitizeOverlayText(body.topic, "");
  const cta = sanitizeOverlayText(body.callToAction ?? "Follow for the next breakdown.", "Follow for the next breakdown.");
  const opener = toneOpeners[body.tone];
  const beats = Math.max(3, Math.min(7, Math.round(body.durationSec / 12)));

  const lines: string[] = [
    `${opener}: ${topic}.`,
    `Most creators miss this because they start editing before they define the hook.`,
    `Instead, map the first 3 seconds, then support it with one visual per beat.`
  ];

  for (let index = 0; index < beats - 2; index += 1) {
    lines.push(`Beat ${index + 1}: Show one concrete proof point tied to ${topic.toLowerCase()}.`);
  }

  lines.push(cta);

  return lines.join(" ");
}

export async function POST(request: Request) {
  try {
    await requireUserWithWorkspace();
    const body = AssistSchema.parse(await request.json());

    const script = buildScript(body);

    return jsonOk({
      script,
      estimatedReadTimeSec: Math.round((script.split(/\s+/).length / 2.4) * 10) / 10,
      safetyNote: "Only use scripts and voice identities you own or have permission to use."
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
