export const DesktopEventNames = [
  "editor_boot",
  "command_latency",
  "background_upload_notice",
  "background_render_notice",
  "drop_import",
  "drag_drop_ingest",
  "offline_draft_sync",
  "media_relink",
  "desktop_notification",
  "app_crash",
  "native_crash",
  "update_check",
  "update_apply",
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

export function extractSessionId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const value = "sessionId" in metadata ? (metadata as { sessionId?: unknown }).sessionId : undefined;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : null;
}

export function normalizeDesktopClientVersion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 64) {
    return null;
  }
  return trimmed;
}

export type DesktopReliabilitySnapshot = {
  totalSessions: number;
  crashSessions: number;
  crashFreeSessionsPct: number | null;
};

export function summarizeDesktopReliability(input: Array<{
  event: string;
  outcome?: DesktopEventOutcome | string | null;
  metadata?: unknown;
}>): DesktopReliabilitySnapshot {
  const sessionStates = new Map<string, { crashed: boolean }>();
  let syntheticSessionCount = 0;

  for (const row of input) {
    const event = normalizeDesktopEventName(row.event) ?? row.event;
    const isCrash = event === "app_crash" || event === "native_crash";
    const sessionId = extractSessionId(row.metadata) ?? `anon_${++syntheticSessionCount}`;
    const current = sessionStates.get(sessionId) ?? { crashed: false };
    if (isCrash || row.outcome === "ERROR") {
      current.crashed = true;
    }
    sessionStates.set(sessionId, current);
  }

  const totalSessions = sessionStates.size;
  const crashSessions = [...sessionStates.values()].filter((state) => state.crashed).length;
  const crashFreeSessionsPct = totalSessions === 0
    ? null
    : Number((((totalSessions - crashSessions) / totalSessions) * 100).toFixed(2));

  return {
    totalSessions,
    crashSessions,
    crashFreeSessionsPct
  };
}
