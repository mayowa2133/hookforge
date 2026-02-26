import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { createStudioRoom, listStudioRooms, StudioRoomCreateSchema } from "@/lib/studio/rooms";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = StudioRoomCreateSchema.parse(await request.json().catch(() => ({})));
    return jsonOk(await createStudioRoom(params.id, body), 201);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function GET(_request: Request, { params }: Context) {
  try {
    return jsonOk(await listStudioRooms(params.id));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
