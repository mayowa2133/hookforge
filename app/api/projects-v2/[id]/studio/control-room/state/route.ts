import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { getStudioControlRoomState } from "@/lib/studio/rooms";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    return jsonOk(await getStudioControlRoomState(params.id));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
