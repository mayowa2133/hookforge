export const DesktopEventNames = [
  "editor_boot",
  "command_latency",
  "background_upload_notice",
  "background_render_notice",
  "drop_import",
  "desktop_menu_action",
  "desktop_shortcut_action"
] as const;

export type DesktopEventName = (typeof DesktopEventNames)[number];
export type DesktopEventOutcome = "SUCCESS" | "ERROR" | "INFO";

const DESKTOP_EVENT_SET = new Set<string>(DesktopEventNames);

export function normalizeDesktopEventName(value: string): DesktopEventName | null {
  if (DESKTOP_EVENT_SET.has(value)) {
    return value as DesktopEventName;
  }
  return null;
}

export function extractDurationMs(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const durationRaw = "durationMs" in metadata ? (metadata as { durationMs?: unknown }).durationMs : undefined;
  if (typeof durationRaw !== "number" || !Number.isFinite(durationRaw)) {
    return null;
  }
  return Math.max(0, Math.round(durationRaw));
}
