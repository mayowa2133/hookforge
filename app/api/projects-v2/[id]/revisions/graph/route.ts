import { z } from "zod";
import { getProjectRevisionGraph } from "@/lib/chat-v2";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(5).max(500).optional()
});

export async function GET(request: Request, { params }: Context) {
  try {
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined
    });
    return jsonOk(await getProjectRevisionGraph(params.id, query.limit ?? 200));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
