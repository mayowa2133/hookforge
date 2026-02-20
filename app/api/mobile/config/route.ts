import { requireCurrentUser } from "@/lib/auth";
import { routeErrorToResponse, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireCurrentUser();
    return jsonOk({
      platforms: [
        {
          id: "ios",
          status: "beta",
          installPath: "web-install",
          notes: "Install from Safari > Share > Add to Home Screen."
        },
        {
          id: "android",
          status: "beta",
          installPath: "web-install",
          notes: "Install from Chrome > Add to Home Screen."
        }
      ],
      quickLinks: {
        dashboard: "/dashboard",
        creator: "/creator",
        growth: "/growth",
        localization: "/localization"
      },
      captureCapabilities: {
        cameraUpload: true,
        teleprompterAssist: true,
        offlineCaptureQueue: false
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
