import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { listRoutingPolicies, normalizeRoutingCapability } from "@/lib/models/route-policy";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const RoutePolicyUpsertSchema = z.object({
  capability: z.string().min(2).max(64),
  activeModelVersionId: z.string().min(1).nullable().optional(),
  fallbackModelVersionId: z.string().min(1).nullable().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
  maxP95LatencyMs: z.number().int().positive().optional(),
  minSuccessRate: z.number().min(0).max(100).optional(),
  enforceQualityGate: z.boolean().optional()
});

export async function GET() {
  try {
    await requireCurrentUser();
    const policies = await listRoutingPolicies();
    return jsonOk({ policies });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = RoutePolicyUpsertSchema.parse(await request.json());
    const capability = normalizeRoutingCapability(body.capability);

    const [activeModel, fallbackModel] = await Promise.all([
      body.activeModelVersionId
        ? prisma.modelVersion.findUnique({ where: { id: body.activeModelVersionId } })
        : Promise.resolve(null),
      body.fallbackModelVersionId
        ? prisma.modelVersion.findUnique({ where: { id: body.fallbackModelVersionId } })
        : Promise.resolve(null)
    ]);

    if (body.activeModelVersionId && !activeModel) {
      throw new Error("Active model version not found");
    }
    if (body.fallbackModelVersionId && !fallbackModel) {
      throw new Error("Fallback model version not found");
    }

    if (activeModel && activeModel.capability !== capability) {
      throw new Error("Active model capability mismatch");
    }
    if (fallbackModel && fallbackModel.capability !== capability) {
      throw new Error("Fallback model capability mismatch");
    }

    const enforceQualityGate = body.enforceQualityGate ?? true;
    if (enforceQualityGate && activeModel) {
      const latestRun = await prisma.qualityEvalRun.findFirst({
        where: {
          modelVersionId: activeModel.id,
          status: "DONE"
        },
        orderBy: { createdAt: "desc" }
      });

      if (!latestRun || latestRun.passed !== true) {
        throw new Error("Active model is missing a passing quality evaluation");
      }
    }

    const policy = await prisma.routingPolicy.upsert({
      where: { capability },
      update: {
        activeModelVersionId: body.activeModelVersionId === undefined ? undefined : body.activeModelVersionId,
        fallbackModelVersionId: body.fallbackModelVersionId === undefined ? undefined : body.fallbackModelVersionId,
        rolloutPercent: body.rolloutPercent,
        maxP95LatencyMs: body.maxP95LatencyMs,
        minSuccessRate: body.minSuccessRate,
        enforceQualityGate,
        updatedByUserId: user.id
      },
      create: {
        capability,
        activeModelVersionId: body.activeModelVersionId ?? null,
        fallbackModelVersionId: body.fallbackModelVersionId ?? null,
        rolloutPercent: body.rolloutPercent ?? 100,
        maxP95LatencyMs: body.maxP95LatencyMs,
        minSuccessRate: body.minSuccessRate,
        enforceQualityGate,
        updatedByUserId: user.id
      },
      include: {
        activeModelVersion: true,
        fallbackModelVersion: true,
        updatedBy: {
          select: {
            id: true,
            email: true
          }
        }
      }
    });

    return jsonOk({ policy }, 201);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
