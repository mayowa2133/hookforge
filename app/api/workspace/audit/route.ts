import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const QuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(200).default(80),
  action: z.string().min(2).max(120).optional(),
  targetType: z.string().min(2).max(120).optional(),
  actorUserId: z.string().min(1).optional()
});

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceCapability({
      capability: "workspace.audit.read",
      request
    });
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      take: url.searchParams.get("take") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      targetType: url.searchParams.get("targetType") ?? undefined,
      actorUserId: url.searchParams.get("actorUserId") ?? undefined
    });

    const auditEvents = await prisma.auditEvent.findMany({
      where: {
        workspaceId: workspace.id,
        ...(query.action ? { action: query.action } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {})
      },
      orderBy: {
        createdAt: "desc"
      },
      take: query.take
    });

    return jsonOk({
      workspaceId: workspace.id,
      auditEvents,
      auditEntries: auditEvents
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
