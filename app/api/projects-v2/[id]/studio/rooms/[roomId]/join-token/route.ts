import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { issueStudioJoinToken, StudioJoinTokenSchema } from "@/lib/studio/rooms";

export const runtime = "nodejs";

type Context = {
  params: { id: string; roomId: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const body = StudioJoinTokenSchema.parse(await request.json());
    return jsonOk(
      await issueStudioJoinToken({
        projectIdOrV2Id: params.id,
        roomId: params.roomId,
        participantName: body.participantName,
        role: body.role,
        pushToTalk: body.pushToTalk,
        ttlSec: body.ttlSec
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
