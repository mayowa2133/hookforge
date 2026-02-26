import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { buildParityScorecardForWorkspace } from "@/lib/parity/scorecard";
import { buildDescriptPlusLaunchReadiness } from "@/lib/parity/launch-readiness";
import { buildPhase6CertificationReadout } from "@/lib/parity/certification";
import { prisma } from "@/lib/prisma";
import { summarizeProviderReadiness } from "@/lib/providers/registry";

const FeatureMatrixSchema = z.object({
  baselineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  competitor: z.string().min(1),
  features: z.array(
    z.object({
      id: z.string().min(1),
      status: z.enum(["planned", "in_progress", "implemented", "verified"]),
      coverage: z.object({
        api: z.array(z.string().min(1)).default([]),
        ui: z.array(z.string().min(1)).default([]),
        tests: z.array(z.string().min(1)).default([])
      })
    })
  ).min(1)
});

async function resolveWorkspaceId() {
  const explicit = process.env.PARITY_WORKSPACE_ID?.trim();
  if (explicit) {
    return explicit;
  }
  const targetEnv = (process.env.PARITY_GATE_TARGET_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
  if (targetEnv === "production" || targetEnv === "staging" || process.env.PARITY_REQUIRE_WORKSPACE_ID === "true") {
    throw new Error("PARITY_WORKSPACE_ID is required for production/staging parity gate checks.");
  }
  const fromStudio = await prisma.studioRoom.groupBy({
    by: ["workspaceId"],
    _count: { _all: true },
    orderBy: {
      _count: {
        id: "desc"
      }
    },
    take: 1
  });
  if (fromStudio[0]?.workspaceId) {
    return fromStudio[0].workspaceId;
  }
  const workspace = await prisma.workspace.findFirst({
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true
    }
  });
  if (!workspace) {
    throw new Error("No workspace found for parity gate check");
  }
  return workspace.id;
}

async function loadFeatureMatrix() {
  const matrixPath = process.env.DESCRIPT_FEATURE_MATRIX_PATH?.trim() || "docs/parity/descript_feature_matrix.json";
  const raw = await readFile(resolve(process.cwd(), matrixPath), "utf8");
  const matrix = FeatureMatrixSchema.parse(JSON.parse(raw));
  const coveredFeatures = matrix.features.filter(
    (feature) =>
      feature.coverage.api.length > 0 &&
      feature.coverage.ui.length > 0 &&
      feature.coverage.tests.length > 0
  ).length;
  const implementedOrVerified = matrix.features.filter(
    (feature) => feature.status === "implemented" || feature.status === "verified"
  ).length;

  return {
    path: matrixPath,
    competitor: matrix.competitor,
    baselineDate: matrix.baselineDate,
    requiredBaselineDate:
      process.env.DESCRIPT_PARITY_BASELINE_DATE?.trim() ||
      process.env.PARITY_BASELINE_DATE?.trim() ||
      "2026-02-26",
    totalFeatures: matrix.features.length,
    coveredFeatures,
    coveragePct: Number(((coveredFeatures / matrix.features.length) * 100).toFixed(2)),
    implementedOrVerifiedPct: Number(((implementedOrVerified / matrix.features.length) * 100).toFixed(2))
  };
}

async function main() {
  const workspaceId = await resolveWorkspaceId();
  const threshold = Number(process.env.PARITY_GATE_MIN_SCORE ?? "70");
  const modulePassRateThreshold = Number(process.env.PARITY_GATE_MIN_PASS_RATE ?? "70");
  const parityGateTargetEnv = (process.env.PARITY_GATE_TARGET_ENV ?? process.env.NODE_ENV ?? "development").toLowerCase();
  const enforceLaunchReadiness = process.env.PARITY_GATE_ENFORCE_LAUNCH !== "false";
  const strictProviderEnv = parityGateTargetEnv === "staging" || parityGateTargetEnv === "production";
  const enforceRealProviders = strictProviderEnv && process.env.PARITY_GATE_ENFORCE_REAL_PROVIDERS !== "false";
  const enforceFeatureMatrix = process.env.PARITY_GATE_ENFORCE_FEATURE_MATRIX !== "false";
  const enforcePhase6Certification =
    process.env.PARITY_GATE_ENFORCE_PHASE6_CERTIFICATION === "true" ||
    (strictProviderEnv && process.env.PARITY_GATE_ENFORCE_PHASE6_CERTIFICATION !== "false");

  const [scorecard, launch, featureMatrix, certification] = await Promise.all([
    buildParityScorecardForWorkspace(workspaceId),
    buildDescriptPlusLaunchReadiness({
      workspaceId,
      persistIncident: false
    }),
    loadFeatureMatrix(),
    buildPhase6CertificationReadout({
      workspaceId,
      persistRun: false
    })
  ]);
  const providerReadiness = summarizeProviderReadiness();
  const featureMatrixGatePassed =
    featureMatrix.coveragePct === 100 &&
    featureMatrix.baselineDate === featureMatrix.requiredBaselineDate;
  const mockPrimaryCount = providerReadiness.rows.filter((row) => row.primaryIsMock).length;
  const providerGatePassed =
    !enforceRealProviders ||
    (providerReadiness.allCapabilitiesHaveConfiguredRealProvider && mockPrimaryCount === 0);
  const gatePassed =
    scorecard.overallScore >= threshold &&
    scorecard.passRate >= modulePassRateThreshold &&
    (!enforceFeatureMatrix || featureMatrixGatePassed) &&
    providerGatePassed &&
    (!enforceLaunchReadiness || !launch.guardrails.shouldRollback) &&
    (!enforcePhase6Certification || certification.certificationPassed);

  console.log(
    JSON.stringify(
      {
        workspaceId: scorecard.workspaceId,
        overallScore: scorecard.overallScore,
        passRate: scorecard.passRate,
        threshold,
        modulePassRateThreshold,
        parityGateTargetEnv,
        strictProviderEnv,
        enforceLaunchReadiness,
        enforceRealProviders,
        enforceFeatureMatrix,
        enforcePhase6Certification,
        gatePassed,
        providers: providerReadiness,
        featureMatrix,
        certification: {
          certificationPassed: certification.certificationPassed,
          overallPassed: certification.overallPassed,
          streak: certification.streak,
          failedDimensions: certification.dimensions.filter((dimension) => !dimension.passed).map((dimension) => dimension.id)
        },
        checks: {
          providerGatePassed,
          featureMatrixGatePassed,
          mockPrimaryCount,
          certificationGatePassed: certification.certificationPassed
        },
        launch: {
          stage: launch.stage,
          status: launch.guardrails.status,
          shouldRollback: launch.guardrails.shouldRollback,
          triggerCount: launch.guardrails.triggers.length
        },
        modules: scorecard.modules.map((module) => ({
          module: module.module,
          score: module.score,
          passed: module.passed
        }))
      },
      null,
      2
    )
  );

  if (!gatePassed) {
    process.exit(2);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
