import { z } from "zod";
import { applyChatPlan } from "@/lib/chat-v2";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const ChatApplySchema = z.object({
  planId: z.string().min(1),
  confirmed: z.literal(true)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = ChatApplySchema.parse(await request.json());
    const result = await applyChatPlan(params.id, body.planId);
    return jsonOk(result);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
