import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

type Context = {
  params: {
    id: string;
  };
};

const UpdateStatusSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "RESOLVED"]),
  note: z.string().max(500).optional()
});

export async function POST(request: Request, { params }: Context) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "billing.manage",
      request
    });
    const body = UpdateStatusSchema.parse(await request.json());

    const anomaly = await prisma.usageAnomaly.findFirst({
      where: {
        id: params.id,
        workspaceId: workspace.id
      }
    });
    if (!anomaly) {
      return jsonError("Anomaly not found", 404);
    }

    const updated = await prisma.usageAnomaly.update({
      where: { id: anomaly.id },
      data: {
        status: body.status,
        resolvedAt: body.status === "RESOLVED" ? new Date() : null,
        resolvedByUserId: body.status === "RESOLVED" ? user.id : null,
        metadata: {
          ...(typeof anomaly.metadata === "object" && anomaly.metadata !== null
            ? (anomaly.metadata as Record<string, unknown>)
            : {}),
          statusNote: body.note ?? null,
          statusUpdatedBy: user.id,
          statusUpdatedAt: new Date().toISOString()
        }
      }
    });

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "billing_anomaly_status",
      targetType: "UsageAnomaly",
      targetId: updated.id,
      details: {
        status: updated.status
      }
    });

    return jsonOk({
      anomaly: updated
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
