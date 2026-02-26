import { z } from "zod";
import { listChatSessions } from "@/lib/chat-v2";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export async function GET(request: Request, { params }: Context) {
  try {
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined
    });
    return jsonOk(await listChatSessions(params.id, query.limit ?? 20));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
