const REQUIRED_CORE_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "SESSION_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "S3_ENDPOINT",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_BUCKET"
] as const;

const REQUIRED_PROVIDER_KEYS = [
  "DEEPGRAM_API_KEY",
  "OPENAI_API_KEY",
  "ELEVENLABS_API_KEY",
  "LIPSYNC_API_KEY",
  "GENERATIVE_MEDIA_API_KEY"
] as const;

function normalizeEnvName(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isTruthy(value: string | undefined) {
  const normalized = normalizeEnvName(value);
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

async function main() {
  const targetEnv = normalizeEnvName(process.env.PARITY_GATE_TARGET_ENV || process.env.NODE_ENV || "development");
  const missingCoreKeys = REQUIRED_CORE_KEYS.filter((key) => !(process.env[key]?.trim()));
  const missingKeys = REQUIRED_PROVIDER_KEYS.filter((key) => !(process.env[key]?.trim()));
  const allowMockProviders = isTruthy(process.env.ALLOW_MOCK_PROVIDERS);
  if (missingCoreKeys.length > 0) {
    console.log(
      JSON.stringify(
        {
          targetEnv,
          strictRuntime: targetEnv === "production" || targetEnv === "staging",
          requiredCoreKeys: REQUIRED_CORE_KEYS,
          missingCoreKeys,
          passed: false
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  const { summarizeProviderReadiness } = await import("@/lib/providers/registry");
  const providerReadiness = summarizeProviderReadiness();
  const mockPrimaryCount = providerReadiness.rows.filter((row) => row.primaryIsMock).length;
  const providerGatePassed = providerReadiness.allCapabilitiesHaveConfiguredRealProvider && mockPrimaryCount === 0;
  const strictRuntime = targetEnv === "production" || targetEnv === "staging";
  const passed = strictRuntime && !allowMockProviders && missingKeys.length === 0 && providerGatePassed;

  console.log(
    JSON.stringify(
      {
        targetEnv,
        strictRuntime,
        allowMockProviders,
        requiredKeys: REQUIRED_PROVIDER_KEYS,
        missingKeys,
        providerGatePassed,
        mockPrimaryCount,
        readiness: providerReadiness,
        passed
      },
      null,
      2
    )
  );

  if (!passed) {
    process.exit(2);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
