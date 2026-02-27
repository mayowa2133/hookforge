import { requireCurrentUser } from "@/lib/auth";
import { DesktopPlatforms, DesktopReleaseChannels } from "@/lib/desktop/releases";
import { projectsV2FeatureFlags } from "@/lib/editor-cutover";
import { env } from "@/lib/env";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireCurrentUser();

    return jsonOk({
      desktop: {
        supported: true,
        shell: "web-first-desktop-shell",
        status: "ga-ready",
        appId: env.DESKTOP_APP_ID,
        defaultUpdateChannel: env.DESKTOP_UPDATE_DEFAULT_CHANNEL,
        packagedTargets: {
          macos: {
            supported: true,
            architectures: ["arm64", "x64"],
            signedBuilds: true,
            installerFormats: ["dmg", "zip"]
          },
          windows: {
            supported: true,
            architectures: ["x64"],
            signedBuilds: true,
            installerFormats: ["exe", "msi"]
          }
        },
        autoUpdate: {
          enabled: true,
          channels: DesktopReleaseChannels,
          releaseEndpoint: "/api/desktop/releases"
        },
        crashReporting: {
          enabled: true,
          eventCategories: ["desktop.app_crash", "desktop.native_crash"],
          privacy: "no-pii-stack-traces"
        }
      },
      cutover: {
        defaultEditorShell: "OPENCUT",
        immediateReplacement: projectsV2FeatureFlags.opencutImmediateReplacement,
        legacyFallbackAllowlistEnabled: projectsV2FeatureFlags.opencutLegacyFallbackAllowlist.length > 0,
        rolloutStage: projectsV2FeatureFlags.descriptPlusRolloutStage,
        autoRollbackEnabled: projectsV2FeatureFlags.descriptPlusAutoRollback,
        forceRollbackToLegacy: projectsV2FeatureFlags.descriptPlusForceRollbackToLegacy
      },
      budgets: {
        editorOpenP95Ms: env.DESCRIPT_PLUS_MAX_EDITOR_OPEN_P95_MS,
        commandLatencyP95Ms: env.DESCRIPT_PLUS_MAX_COMMAND_P95_MS,
        crashFreeSessionsPct: env.DESCRIPT_PLUS_MIN_DESKTOP_CRASH_FREE_PCT
      },
      desktopCi: {
        paritySuite: "test:e2e:phase012345",
        requiredTargets: DesktopPlatforms,
        crashFreeTargetPct: env.DESCRIPT_PLUS_MIN_DESKTOP_CRASH_FREE_PCT
      },
      nativeMenu: [
        { id: "file.new_recording", label: "New Recording", shortcut: "CmdOrCtrl+N" },
        { id: "file.import_media", label: "Import Media", shortcut: "CmdOrCtrl+I" },
        { id: "edit.split", label: "Split at Playhead", shortcut: "CmdOrCtrl+B" },
        { id: "edit.undo", label: "Undo", shortcut: "CmdOrCtrl+Z" },
        { id: "edit.redo", label: "Redo", shortcut: "CmdOrCtrl+Shift+Z" },
        { id: "render.export", label: "Render Export", shortcut: "CmdOrCtrl+Enter" }
      ],
      shortcuts: {
        transport: ["Space", "J", "K", "L"],
        timeline: ["CmdOrCtrl+B", "Delete", "[", "]", "Shift+D"],
        transcript: ["CmdOrCtrl+Shift+S", "CmdOrCtrl+Shift+M"],
        desktop: ["CmdOrCtrl+I", "CmdOrCtrl+Shift+R", "CmdOrCtrl+Shift+U"]
      },
      workflows: {
        dragDropIngest: true,
        offlineDraftSync: true,
        mediaRelink: true,
        desktopNotifications: true
      },
      endpoints: {
        desktopEvents: "/api/desktop/events",
        desktopReleases: "/api/desktop/releases",
        projectPerfHints: "/api/projects-v2/:id/perf-hints",
        projectDesktopIngestDrop: "/api/projects-v2/:id/desktop/ingest-drop",
        projectDesktopOfflineDrafts: "/api/projects-v2/:id/desktop/offline-drafts",
        projectDesktopMediaRelink: "/api/projects-v2/:id/desktop/media-relink",
        projectDesktopNotifications: "/api/projects-v2/:id/desktop/notifications",
        queueHealth: "/api/ops/queues/health"
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
