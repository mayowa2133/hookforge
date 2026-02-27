import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import {
  DesktopPlatforms,
  DesktopReleaseChannels,
  loadDesktopReleaseManifest,
  resolveDesktopReleaseUpdate
} from "@/lib/desktop/releases";
import { env } from "@/lib/env";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

const QuerySchema = z.object({
  platform: z.enum(DesktopPlatforms).default("darwin-arm64"),
  channel: z.enum(DesktopReleaseChannels).default("stable"),
  currentVersion: z.string().trim().min(1).max(64).optional()
});

export async function GET(request: Request) {
  try {
    await requireCurrentUser();
    const url = new URL(request.url);
    const query = QuerySchema.parse({
      platform: url.searchParams.get("platform") ?? undefined,
      channel: url.searchParams.get("channel") ?? undefined,
      currentVersion: url.searchParams.get("currentVersion") ?? undefined
    });

    const manifest = loadDesktopReleaseManifest();
    const release = resolveDesktopReleaseUpdate({
      manifest,
      platform: query.platform,
      channel: query.channel,
      currentVersion: query.currentVersion,
      signingSalt: env.DESKTOP_RELEASE_SIGNING_SALT
    });

    return jsonOk({
      generatedAt: manifest.generatedAt,
      ...release
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
