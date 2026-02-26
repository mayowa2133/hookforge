import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { AudioFillerSchema } from "@/lib/audio/schemas";
import { applyFillerRemoval } from "@/lib/audio/phase3";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = AudioFillerSchema.parse(await request.json());
    return jsonOk(await applyFillerRemoval(params.id, body));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

