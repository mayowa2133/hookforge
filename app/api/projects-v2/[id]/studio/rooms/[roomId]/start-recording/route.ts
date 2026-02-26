import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { startStudioRecording } from "@/lib/studio/rooms";

export const runtime = "nodejs";

type Context = {
  params: { id: string; roomId: string };
};

export async function POST(_request: Request, { params }: Context) {
  try {
    return jsonOk(await startStudioRecording(params.id, params.roomId));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
