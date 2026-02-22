import { z } from "zod";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { isSupportedLanguage } from "@/lib/languages";
import { enqueueTranscriptAuto } from "@/lib/transcript/service";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const AutoTranscriptSchema = z.object({
  language: z.string().min(2).max(12).default("en"),
  diarization: z.boolean().default(false),
  punctuationStyle: z.enum(["auto", "minimal", "full"]).default("auto"),
  confidenceThreshold: z.number().min(0.55).max(0.99).default(0.86),
  reDecodeEnabled: z.boolean().default(true),
  maxWordsPerSegment: z.number().int().min(3).max(12).default(7),
  maxCharsPerLine: z.number().int().min(14).max(42).default(24),
  maxLinesPerSegment: z.number().int().min(1).max(3).default(2)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = AutoTranscriptSchema.parse(await request.json());
    if (!isSupportedLanguage(body.language)) {
      throw new Error(`Unsupported language: ${body.language}`);
    }

    const { aiJob, trackId } = await enqueueTranscriptAuto(params.id, body);
    return jsonOk(
      {
        aiJobId: aiJob.id,
        status: aiJob.status,
        trackId
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
