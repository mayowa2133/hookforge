import { getPublishConnectorJob } from "@/lib/publish/connectors";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string; jobId: string };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    return jsonOk(await getPublishConnectorJob(params.id, params.jobId));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
