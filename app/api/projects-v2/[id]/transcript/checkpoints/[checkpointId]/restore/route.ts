import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { restoreTranscriptCheckpoint } from "@/lib/transcript/document";

export const runtime = "nodejs";

type Context = {
  params: { id: string; checkpointId: string };
};

export async function POST(_request: Request, { params }: Context) {
  try {
    return jsonOk(
      await restoreTranscriptCheckpoint({
        projectIdOrV2Id: params.id,
        checkpointId: params.checkpointId
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
