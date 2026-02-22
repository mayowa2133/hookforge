import { requireCurrentUser } from "@/lib/auth";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import {
  RESUMABLE_DEFAULT_PART_SIZE_BYTES,
  RESUMABLE_MIN_PART_SIZE_BYTES,
  RESUMABLE_SESSION_TTL_SEC
} from "@/lib/mobile/resumable";

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
        offlineCaptureQueue: true,
        resumableUploads: true,
        networkRecoveryResume: true
      },
      mobileUpload: {
        protocol: "s3-multipart-presigned",
        minPartSizeBytes: RESUMABLE_MIN_PART_SIZE_BYTES,
        recommendedPartSizeBytes: RESUMABLE_DEFAULT_PART_SIZE_BYTES,
        sessionTtlSec: RESUMABLE_SESSION_TTL_SEC,
        endpoints: {
          initiate: "/api/mobile/uploads/resumable/initiate",
          getPartUrl: "/api/mobile/uploads/resumable/:sessionId/part-url",
          completePart: "/api/mobile/uploads/resumable/:sessionId/part-complete",
          status: "/api/mobile/uploads/resumable/:sessionId",
          complete: "/api/mobile/uploads/resumable/:sessionId/complete",
          abort: "/api/mobile/uploads/resumable/:sessionId/abort"
        }
      },
      telemetry: {
        ingestEndpoint: "/api/mobile/telemetry",
        healthEndpoint: "/api/mobile/health",
        topWorkflowsEndpoint: "/api/mobile/workflows/top"
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
