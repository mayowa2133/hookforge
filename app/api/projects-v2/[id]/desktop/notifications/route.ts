import { z } from "zod";
import {
  acknowledgeProjectDesktopNotifications,
  listProjectDesktopNotifications
} from "@/lib/desktop/project-native";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = { params: { id: string } };

const NotificationsAckSchema = z.object({
  notificationIds: z.array(z.string().trim().min(1).max(160)).min(1).max(200)
});

export async function GET(request: Request, { params }: Context) {
  try {
    const url = new URL(request.url);
    const includeAcknowledged = url.searchParams.get("includeAcknowledged") === "1";
    return jsonOk(
      await listProjectDesktopNotifications({
        projectIdOrV2Id: params.id,
        includeAcknowledged
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const body = NotificationsAckSchema.parse(await request.json());
    return jsonOk(
      await acknowledgeProjectDesktopNotifications({
        projectIdOrV2Id: params.id,
        notificationIds: body.notificationIds
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
