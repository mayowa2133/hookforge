import { z } from "zod";
import { applyChatPlanWithHash } from "@/lib/chat-v2";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const ChatApplySchema = z.object({
  planId: z.string().min(1),
  planRevisionHash: z.string().min(8),
  confirmed: z.literal(true),
  operationDecisions: z.array(
    z.object({
      itemId: z.string().min(1),
      accepted: z.boolean()
    })
  ).max(200).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = ChatApplySchema.parse(await request.json());
    const result = await applyChatPlanWithHash(params.id, body.planId, body.planRevisionHash, body.operationDecisions);
    return jsonOk(result);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
