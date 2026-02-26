import { z } from "zod";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { createTranscriptCheckpoint } from "@/lib/transcript/document";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const CreateCheckpointSchema = z.object({
  language: z.string().trim().min(2).max(12).optional(),
  label: z.string().trim().min(1).max(120).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = CreateCheckpointSchema.parse(await request.json().catch(() => ({})));
    return jsonOk(
      await createTranscriptCheckpoint({
        projectIdOrV2Id: params.id,
        language: body.language,
        label: body.label
      }),
      201
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
