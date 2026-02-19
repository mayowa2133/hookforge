export function sanitizeOverlayText(input: string, fallback = "") {
  const normalized = input.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 80);
}
