import { z } from "zod";
import { undoChatPlanApply } from "@/lib/chat-v2";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const UndoSchema = z.object({
  undoToken: z.string().min(8)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = UndoSchema.parse(await request.json());
    return jsonOk(await undoChatPlanApply(params.id, body.undoToken));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
