import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getStudioRoom } from "@/lib/studio/rooms";

export const runtime = "nodejs";

type Context = {
  params: { id: string; roomId: string };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    return jsonOk(await getStudioRoom(params.id, params.roomId));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
