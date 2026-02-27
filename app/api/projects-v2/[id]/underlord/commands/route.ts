import { listUnderlordCommandCatalog } from "@/lib/autopilot";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonOk(listUnderlordCommandCatalog());
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

