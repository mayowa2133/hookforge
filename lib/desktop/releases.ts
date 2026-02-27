import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const DesktopPlatforms = ["darwin-arm64", "darwin-x64", "win32-x64"] as const;
export const DesktopReleaseChannels = ["stable", "beta", "canary"] as const;

export type DesktopPlatform = (typeof DesktopPlatforms)[number];
export type DesktopReleaseChannel = (typeof DesktopReleaseChannels)[number];

export type DesktopReleaseArtifact = {
  version: string;
  platform: DesktopPlatform;
  channel: DesktopReleaseChannel;
  buildId: string;
  publishedAt: string;
  downloadUrl: string;
  checksumSha256: string;
  signature: string;
  signed: boolean;
  notes: string;
  minOsVersion: string | null;
};

export type DesktopReleaseManifest = {
  generatedAt: string;
  releases: DesktopReleaseArtifact[];
};

const DEFAULT_RELEASE_MANIFEST: DesktopReleaseManifest = {
  generatedAt: "2026-02-26T00:00:00.000Z",
  releases: [
    {
      version: "1.0.0",
      platform: "darwin-arm64",
      channel: "stable",
      buildId: "mac-arm64-100",
      publishedAt: "2026-02-20T12:00:00.000Z",
      downloadUrl: "https://downloads.hookforge.dev/desktop/stable/HookForge-1.0.0-arm64.dmg",
      checksumSha256: "f7f8f0f2c802076f99003eb51f1965cd352213f4f740f4f57bb4ab68e5f16af3",
      signature: "b190f36f362a3815c7ef53add7f8f2ba5c0106f57cc23d17a27f1bf4bc584cf0",
      signed: true,
      notes: "Desktop GA baseline",
      minOsVersion: "13.0"
    }
  ]
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeSemver(value: string) {
  return value.trim().replace(/^v/i, "");
}

function compareVersion(a: string, b: string) {
  const av = normalizeSemver(a).split(".").map((part) => Number(part.replace(/[^0-9].*$/, "")) || 0);
  const bv = normalizeSemver(b).split(".").map((part) => Number(part.replace(/[^0-9].*$/, "")) || 0);
  const length = Math.max(av.length, bv.length, 3);
  for (let index = 0; index < length; index += 1) {
    const ai = av[index] ?? 0;
    const bi = bv[index] ?? 0;
    if (ai > bi) {
      return 1;
    }
    if (ai < bi) {
      return -1;
    }
  }
  return 0;
}

function normalizeReleaseArtifact(value: unknown): DesktopReleaseArtifact | null {
  const raw = asRecord(value);
  const platform = DesktopPlatforms.find((entry) => entry === raw.platform);
  const channel = DesktopReleaseChannels.find((entry) => entry === raw.channel);

  if (!platform || !channel) {
    return null;
  }

  const version = typeof raw.version === "string" ? normalizeSemver(raw.version) : "";
  const buildId = typeof raw.buildId === "string" ? raw.buildId.trim().slice(0, 120) : "";
  const publishedAt = typeof raw.publishedAt === "string" ? raw.publishedAt : "";
  const downloadUrl = typeof raw.downloadUrl === "string" ? raw.downloadUrl : "";
  const checksumSha256 = typeof raw.checksumSha256 === "string" ? raw.checksumSha256.toLowerCase() : "";
  const signature = typeof raw.signature === "string" ? raw.signature.toLowerCase() : "";
  const signed = raw.signed === true;
  const notes = typeof raw.notes === "string" ? raw.notes.trim().slice(0, 2000) : "";
  const minOsVersion = typeof raw.minOsVersion === "string"
    ? raw.minOsVersion.trim().slice(0, 32)
    : null;

  if (!version || !buildId || !downloadUrl || checksumSha256.length !== 64 || signature.length !== 64) {
    return null;
  }

  return {
    version,
    platform,
    channel,
    buildId,
    publishedAt,
    downloadUrl,
    checksumSha256,
    signature,
    signed,
    notes,
    minOsVersion
  };
}

export function computeDesktopReleaseSignature(artifact: {
  version: string;
  platform: DesktopPlatform;
  channel: DesktopReleaseChannel;
  buildId: string;
  checksumSha256: string;
}, signingSalt = "hookforge-desktop-signing") {
  return createHash("sha256")
    .update(`${normalizeSemver(artifact.version)}|${artifact.platform}|${artifact.channel}|${artifact.buildId}|${artifact.checksumSha256}|${signingSalt}`)
    .digest("hex");
}

export function verifyDesktopReleaseSignature(artifact: DesktopReleaseArtifact, signingSalt = "hookforge-desktop-signing") {
  const expected = computeDesktopReleaseSignature({
    version: artifact.version,
    platform: artifact.platform,
    channel: artifact.channel,
    buildId: artifact.buildId,
    checksumSha256: artifact.checksumSha256
  }, signingSalt);
  return artifact.signed && expected === artifact.signature;
}

export function normalizeDesktopReleaseManifest(rawManifest: unknown): DesktopReleaseManifest {
  const raw = asRecord(rawManifest);
  const releases = Array.isArray(raw.releases)
    ? raw.releases
        .map(normalizeReleaseArtifact)
        .filter((entry): entry is DesktopReleaseArtifact => Boolean(entry))
        .sort((a, b) => {
          const byVersion = compareVersion(b.version, a.version);
          if (byVersion !== 0) {
            return byVersion;
          }
          return b.publishedAt.localeCompare(a.publishedAt);
        })
    : [];

  return {
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : new Date(0).toISOString(),
    releases: releases.length > 0 ? releases : DEFAULT_RELEASE_MANIFEST.releases
  };
}

export function loadDesktopReleaseManifest() {
  const manifestPath = resolve(process.cwd(), "docs/desktop/releases.json");
  try {
    const raw = readFileSync(manifestPath, "utf8");
    return normalizeDesktopReleaseManifest(JSON.parse(raw));
  } catch {
    return DEFAULT_RELEASE_MANIFEST;
  }
}

export function resolveDesktopReleaseUpdate(params: {
  manifest: DesktopReleaseManifest;
  platform: DesktopPlatform;
  channel: DesktopReleaseChannel;
  currentVersion?: string | null;
  signingSalt?: string;
}) {
  const candidates = params.manifest.releases
    .filter((release) => release.platform === params.platform && release.channel === params.channel)
    .filter((release) => verifyDesktopReleaseSignature(release, params.signingSalt));

  const latest = candidates[0] ?? null;
  const currentVersion = params.currentVersion ? normalizeSemver(params.currentVersion) : null;
  const updateAvailable = Boolean(latest && (!currentVersion || compareVersion(latest.version, currentVersion) > 0));

  return {
    platform: params.platform,
    channel: params.channel,
    currentVersion,
    latest,
    updateAvailable,
    signedReleaseCount: candidates.length
  };
}
