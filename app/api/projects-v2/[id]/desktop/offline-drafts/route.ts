import { z } from "zod";
import {
  getProjectDesktopOfflineDrafts,
  upsertProjectDesktopOfflineDraft
} from "@/lib/desktop/project-native";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = { params: { id: string } };

const OfflineDraftSchema = z.object({
  draftId: z.string().trim().min(1).max(120),
  clientId: z.string().trim().min(1).max(120),
  basedOnRevisionId: z.string().trim().min(1).max(120).nullable().optional(),
  clear: z.boolean().optional(),
  operations: z.array(z.record(z.string(), z.unknown())).max(500).optional()
});

export async function GET(_request: Request, { params }: Context) {
  try {
    return jsonOk(await getProjectDesktopOfflineDrafts(params.id));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const body = OfflineDraftSchema.parse(await request.json());
    return jsonOk(
      await upsertProjectDesktopOfflineDraft({
        projectIdOrV2Id: params.id,
        draftId: body.draftId,
        clientId: body.clientId,
        basedOnRevisionId: body.basedOnRevisionId,
        operations: body.operations,
        clear: body.clear
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
