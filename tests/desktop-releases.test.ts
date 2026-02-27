import { describe, expect, it } from "vitest";
import {
  computeDesktopReleaseSignature,
  normalizeDesktopReleaseManifest,
  resolveDesktopReleaseUpdate,
  verifyDesktopReleaseSignature
} from "@/lib/desktop/releases";

describe("desktop release manifest", () => {
  it("verifies deterministic signatures", () => {
    const signature = computeDesktopReleaseSignature({
      version: "1.0.0",
      platform: "darwin-arm64",
      channel: "stable",
      buildId: "build_1",
      checksumSha256: "f7f8f0f2c802076f99003eb51f1965cd352213f4f740f4f57bb4ab68e5f16af3"
    }, "secret");

    expect(signature).toHaveLength(64);
    expect(signature).toMatch(/^[a-f0-9]+$/);
  });

  it("resolves update availability by platform/channel/version", () => {
    const checksumSha256 = "f7f8f0f2c802076f99003eb51f1965cd352213f4f740f4f57bb4ab68e5f16af3";
    const signature = computeDesktopReleaseSignature({
      version: "1.2.0",
      platform: "win32-x64",
      channel: "stable",
      buildId: "win-build",
      checksumSha256
    }, "secret");

    const manifest = normalizeDesktopReleaseManifest({
      generatedAt: new Date().toISOString(),
      releases: [
        {
          version: "1.2.0",
          platform: "win32-x64",
          channel: "stable",
          buildId: "win-build",
          publishedAt: "2026-02-25T00:00:00.000Z",
          downloadUrl: "https://downloads.example.com/1.2.0.exe",
          checksumSha256,
          signature,
          signed: true,
          notes: "Stable build",
          minOsVersion: "10"
        }
      ]
    });

    const result = resolveDesktopReleaseUpdate({
      manifest,
      platform: "win32-x64",
      channel: "stable",
      currentVersion: "1.1.0",
      signingSalt: "secret"
    });

    expect(result.updateAvailable).toBe(true);
    expect(result.latest?.version).toBe("1.2.0");
    expect(verifyDesktopReleaseSignature(result.latest!, "secret")).toBe(true);
  });
});
