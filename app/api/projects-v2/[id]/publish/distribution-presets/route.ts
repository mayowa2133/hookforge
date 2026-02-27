import { listProjectDistributionPresets } from "@/lib/publish/connectors";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    return jsonOk(await listProjectDistributionPresets(params.id));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
