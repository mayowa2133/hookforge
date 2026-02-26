import { z } from "zod";
import { undoChatPlanApplyWithMode } from "@/lib/chat-v2";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const UndoSchema = z.object({
  undoToken: z.string().min(8),
  force: z.boolean().optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = UndoSchema.parse(await request.json());
    return jsonOk(await undoChatPlanApplyWithMode(params.id, body.undoToken, Boolean(body.force)));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
