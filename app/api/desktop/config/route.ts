import { requireCurrentUser } from "@/lib/auth";
import { projectsV2FeatureFlags } from "@/lib/editor-cutover";
import { jsonOk, routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireCurrentUser();

    return jsonOk({
      desktop: {
        supported: true,
        shell: "web-first-desktop-shell",
        status: "beta-ready"
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
        editorOpenP95Ms: 2500,
        commandLatencyP95Ms: 100
      },
      nativeMenu: [
        { id: "file.new_recording", label: "New Recording", shortcut: "CmdOrCtrl+N" },
        { id: "edit.split", label: "Split at Playhead", shortcut: "CmdOrCtrl+B" },
        { id: "edit.undo", label: "Undo", shortcut: "CmdOrCtrl+Z" },
        { id: "edit.redo", label: "Redo", shortcut: "CmdOrCtrl+Shift+Z" },
        { id: "render.export", label: "Render Export", shortcut: "CmdOrCtrl+Enter" }
      ],
      shortcuts: {
        transport: ["Space", "J", "K", "L"],
        timeline: ["CmdOrCtrl+B", "Delete", "[", "]", "Shift+D"],
        transcript: ["CmdOrCtrl+Shift+S", "CmdOrCtrl+Shift+M"]
      },
      endpoints: {
        desktopEvents: "/api/desktop/events",
        projectPerfHints: "/api/projects-v2/:id/perf-hints",
        queueHealth: "/api/ops/queues/health"
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
