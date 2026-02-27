import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { applyStudioControlRoomAction, StudioControlRoomActionSchema } from "@/lib/studio/rooms";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = StudioControlRoomActionSchema.parse(await request.json());
    return jsonOk(await applyStudioControlRoomAction(params.id, body));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
