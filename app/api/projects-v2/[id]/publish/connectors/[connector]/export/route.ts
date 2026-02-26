import { enqueuePublishConnectorExport, PublishConnectorSchema, PublishExportSchema } from "@/lib/publish/connectors";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string; connector: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const connector = PublishConnectorSchema.parse(params.connector);
    const body = PublishExportSchema.parse(await request.json().catch(() => ({})));
    return jsonOk(
      await enqueuePublishConnectorExport({
        projectIdOrV2Id: params.id,
        connector,
        input: body
      }),
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
