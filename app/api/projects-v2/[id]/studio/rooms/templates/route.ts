import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { listStudioRoomTemplates } from "@/lib/studio/rooms";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(_request: Request, _context: Context) {
  try {
    return jsonOk({
      templates: listStudioRoomTemplates()
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
