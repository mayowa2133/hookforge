import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { createQualityEvalRun } from "@/lib/quality/evals";

export const runtime = "nodejs";

const RunEvalSchema = z.object({
  capability: z.string().min(2).max(64),
  modelVersionId: z.string().min(1).optional(),
  datasetRef: z.string().min(1).max(256).optional(),
  trigger: z.enum(["manual", "ci", "canary", "scheduled"]).optional(),
  metrics: z.record(z.unknown()).optional()
});

export async function POST(request: Request) {
  try {
    const { user } = await requireUserWithWorkspace();
    const body = RunEvalSchema.parse(await request.json());

    if (body.modelVersionId) {
      const modelVersion = await prisma.modelVersion.findUnique({ where: { id: body.modelVersionId } });
      if (!modelVersion) {
        throw new Error("Model version not found");
      }
      if (modelVersion.capability !== body.capability) {
        throw new Error("Model version capability mismatch");
      }
    }

    const result = await createQualityEvalRun({
      capability: body.capability,
      modelVersionId: body.modelVersionId,
      datasetRef: body.datasetRef,
      trigger: body.trigger,
      createdByUserId: user.id,
      metricInput: body.metrics
    });

    return jsonOk(
      {
        evalRunId: result.run.id,
        status: result.run.status,
        passed: result.gate.passed,
        capability: result.gate.capability,
        checks: result.gate.checks,
        reasons: result.gate.reasons,
        metrics: result.metrics,
        summary: result.run.summary,
        finishedAt: result.run.finishedAt
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
