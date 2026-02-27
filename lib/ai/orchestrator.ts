import { prisma } from "../prisma";
import { Prisma } from "@prisma/client";
import { logger } from "../observability/logger";
import { metrics } from "../observability/metrics";
import { applyPhase2SideEffects } from "./phase2";
import { applyPhase3SideEffects } from "./phase3";
import { applyPhase4SideEffects } from "./phase4";
import { applyPhase5SideEffects } from "./phase5";
import { resolveProviderForCapability } from "../models/provider-routing";
import type { ProviderCapability } from "../providers/types";

const capabilityByJobType: Record<string, ProviderCapability> = {
  INGEST_URL: "generative_media",
  TRANSCRIBE: "asr",
  CAPTION_TRANSLATE: "translation",
  AI_EDIT: "generative_media",
  CHAT_EDIT: "generative_media",
  AI_CREATOR: "generative_media",
  AI_ADS: "generative_media",
  AI_SHORTS: "generative_media",
  DUBBING: "translation",
  LIPSYNC: "lip_sync",
  EYE_CONTACT: "generative_media",
  DENOISE: "music_sfx"
};

export async function processAIJob(aiJobId: string) {
  const aiJob = await prisma.aIJob.findUnique({ where: { id: aiJobId } });
  if (!aiJob) {
    throw new Error(`AI job not found: ${aiJobId}`);
  }

  const capability = capabilityByJobType[aiJob.type] ?? "generative_media";
  const routing = await resolveProviderForCapability(capability);
  const provider = routing.provider;

  await prisma.aIJob.update({
    where: { id: aiJob.id },
    data: {
      status: "RUNNING",
      progress: 20
    }
  });

  const startedAt = Date.now();
  try {
    const providerResponse = await provider.run({
      operation: aiJob.type,
      payload: (aiJob.input as Record<string, unknown>) ?? {}
    });

    await prisma.aIJob.update({
      where: { id: aiJob.id },
      data: {
        progress: 62
      }
    });

    const phase2SideEffects = await applyPhase2SideEffects(aiJob);
    const phase3SideEffects = await applyPhase3SideEffects(aiJob);
    const phase4SideEffects = await applyPhase4SideEffects(aiJob);
    const phase5SideEffects = await applyPhase5SideEffects(aiJob);
    const sideEffects =
      phase2SideEffects || phase3SideEffects || phase4SideEffects || phase5SideEffects
        ? {
            phase2: phase2SideEffects,
            phase3: phase3SideEffects,
            phase4: phase4SideEffects,
            phase5: phase5SideEffects
          }
        : null;

    await prisma.aIJob.update({
      where: { id: aiJob.id },
      data: {
        progress: 88
      }
    });

    const durationMs = Date.now() - startedAt;
    const providerDurationMs = providerResponse.usage?.durationMs ?? durationMs;
    const providerCostUsd = providerResponse.usage?.costUsd ?? 0;

    await prisma.aIProviderRun.create({
      data: {
        aiJobId: aiJob.id,
        providerName: providerResponse.providerName,
        operation: aiJob.type,
        model: providerResponse.model,
        request: aiJob.input as Prisma.InputJsonValue,
        response: {
          ...(providerResponse.output as Record<string, unknown>),
          routeSource: routing.routeSource,
          routingPolicyId: routing.policyId,
          routedModelVersionId: routing.modelVersionId
        } as Prisma.InputJsonValue,
        tokensIn: providerResponse.usage?.tokensIn,
        tokensOut: providerResponse.usage?.tokensOut,
        durationMs: providerDurationMs,
        costUsd: providerCostUsd
      }
    });

    await prisma.aIOperationResult.create({
      data: {
        aiJobId: aiJob.id,
        kind: `${aiJob.type.toLowerCase()}_result`,
        output: {
          provider: providerResponse.output,
          sideEffects
        } as Prisma.InputJsonValue
      }
    });

    await prisma.aIJob.update({
      where: { id: aiJob.id },
      data: {
        status: "DONE",
        progress: 100,
        output: {
          provider: providerResponse.output,
          sideEffects
        } as Prisma.InputJsonValue,
        errorMessage: null
      }
    });

    metrics.increment("ai_job_completed", 1, {
      type: aiJob.type,
      provider: provider.name,
      routeSource: routing.routeSource
    });
    metrics.increment("provider_call_completed", 1, {
      capability,
      provider: provider.name,
      routeSource: routing.routeSource
    });
    metrics.observe("ai_job_duration_ms", durationMs, {
      type: aiJob.type,
      provider: provider.name,
      routeSource: routing.routeSource
    });
    metrics.observe("provider_call_duration_ms", providerDurationMs, {
      capability,
      provider: provider.name,
      routeSource: routing.routeSource
    });
    metrics.observe("provider_call_cost_usd", providerCostUsd, {
      capability,
      provider: provider.name,
      routeSource: routing.routeSource
    });

    return {
      aiJobId: aiJob.id,
      status: "DONE" as const
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI job failed";
    await prisma.aIJob.update({
      where: { id: aiJob.id },
      data: {
        status: "ERROR",
        progress: 100,
        errorMessage: message
      }
    });
    metrics.increment("ai_job_failed", 1, { type: aiJob.type });
    metrics.increment("provider_call_failed", 1, {
      capability,
      provider: provider.name,
      routeSource: routing.routeSource
    });
    logger.error("AI job failed", {
      aiJobId: aiJob.id,
      type: aiJob.type,
      message
    });
    throw error;
  }
}
