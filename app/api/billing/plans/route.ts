import { requireWorkspaceCapability } from "@/lib/api-context";
import { creditPacks, planCatalog } from "@/lib/billing/catalog";
import { routeErrorToResponse, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireWorkspaceCapability({
      capability: "billing.read",
      request
    });
    return jsonOk({
      plans: planCatalog,
      creditPacks
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
