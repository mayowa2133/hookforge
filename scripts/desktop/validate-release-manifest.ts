import { loadDesktopReleaseManifest, resolveDesktopReleaseUpdate } from "@/lib/desktop/releases";

const platforms = ["darwin-arm64", "darwin-x64", "win32-x64"] as const;
const channels = ["stable", "beta", "canary"] as const;

function main() {
  const manifest = loadDesktopReleaseManifest();
  const signingSalt = process.env.DESKTOP_RELEASE_SIGNING_SALT ?? "hookforge-desktop-signing";

  const checks = platforms.flatMap((platform) =>
    channels.map((channel) =>
      resolveDesktopReleaseUpdate({
        manifest,
        platform,
        channel,
        signingSalt
      })
    )
  );

  const stableCoverage = checks.filter((entry) => entry.channel === "stable");
  const missingStable = stableCoverage.filter((entry) => !entry.latest);
  const unsignedStable = stableCoverage.filter((entry) => entry.latest && entry.signedReleaseCount === 0);

  const payload = {
    generatedAt: manifest.generatedAt,
    totalReleases: manifest.releases.length,
    stableCoverage: stableCoverage.map((entry) => ({
      platform: entry.platform,
      latestVersion: entry.latest?.version ?? null,
      signedReleaseCount: entry.signedReleaseCount
    })),
    checks
  };

  console.log(JSON.stringify(payload, null, 2));

  if (missingStable.length > 0 || unsignedStable.length > 0) {
    process.exit(2);
  }
}

main();
