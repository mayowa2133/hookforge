import { env } from "./env";

const allowedProtocols = new Set(["http:", "https:"]);

export function validateImportUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  if (!allowedProtocols.has(parsed.protocol)) {
    throw new Error("Only http/https URLs are allowed");
  }
  return parsed;
}

export function parseSourceType(sourceType: string): "WEBSITE" | "YOUTUBE" | "REDDIT" | "OTHER" {
  const normalized = sourceType.toUpperCase();
  if (normalized === "YOUTUBE") return "YOUTUBE";
  if (normalized === "REDDIT") return "REDDIT";
  if (normalized === "WEBSITE") return "WEBSITE";
  return "OTHER";
}

export function assertUrlImportEnabled() {
  if (!env.ENABLE_URL_IMPORT) {
    throw new Error("URL import is disabled");
  }
}
