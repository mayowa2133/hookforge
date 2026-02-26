import { z } from "zod";
import { createProjectShareLink, listProjectShareLinks } from "@/lib/review-phase5";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const CreateShareLinkSchema = z.object({
  scope: z.enum(["VIEW", "COMMENT", "APPROVE"]).default("VIEW"),
  expiresInDays: z.number().int().min(1).max(365).optional()
});

export async function GET(request: Request, { params }: Context) {
  try {
    const payload = await listProjectShareLinks(params.id, request);
    return jsonOk(payload);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const body = CreateShareLinkSchema.parse(await request.json());
    const payload = await createProjectShareLink({
      projectIdOrV2Id: params.id,
      request,
      scope: body.scope,
      expiresInDays: body.expiresInDays
    });
    return jsonOk(payload, 201);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
