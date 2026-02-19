import { prisma } from "../prisma";
import { Prisma } from "@prisma/client";
import { getQueue, queueNames, type QueueName } from "../queue";
import { logger } from "../observability/logger";
import { metrics } from "../observability/metrics";

export type AIJobSubmission = {
  workspaceId: string;
  projectId?: string;
  type:
    | "INGEST_URL"
    | "TRANSCRIBE"
    | "CAPTION_TRANSLATE"
    | "AI_EDIT"
    | "CHAT_EDIT"
    | "AI_CREATOR"
    | "AI_ADS"
    | "AI_SHORTS"
    | "DUBBING"
    | "LIPSYNC"
    | "EYE_CONTACT"
    | "DENOISE";
  queueName: QueueName;
  input: Record<string, unknown>;
  providerHint?: string;
};

export async function enqueueAIJob(params: AIJobSubmission) {
  const aiJob = await prisma.aIJob.create({
    data: {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      type: params.type,
      status: "QUEUED",
      progress: 0,
      providerHint: params.providerHint,
      input: params.input as Prisma.InputJsonValue
    }
  });

  const queue = getQueue(params.queueName);
  await queue.add(
    params.type.toLowerCase(),
    {
      aiJobId: aiJob.id
    },
    {
      // BullMQ rejects custom IDs containing ":".
      jobId: `aijob-${aiJob.id}`
    }
  );

  metrics.increment("ai_job_enqueued", 1, { queue: params.queueName, type: params.type });
  logger.info("AI job enqueued", {
    aiJobId: aiJob.id,
    queue: params.queueName,
    type: params.type
  });

  return aiJob;
}

export function queueNameForJobType(type: AIJobSubmission["type"], lipDub?: boolean): QueueName {
  switch (type) {
    case "INGEST_URL":
      return queueNames.ingest;
    case "TRANSCRIBE":
      return queueNames.transcribe;
    case "CAPTION_TRANSLATE":
      return queueNames.translate;
    case "DUBBING":
      return lipDub ? queueNames.dubLipSync : queueNames.translate;
    case "LIPSYNC":
      return queueNames.dubLipSync;
    case "AI_EDIT":
    case "CHAT_EDIT":
      return queueNames.aiEdit;
    case "AI_CREATOR":
    case "AI_ADS":
    case "AI_SHORTS":
    case "EYE_CONTACT":
    case "DENOISE":
      return queueNames.aiGenerate;
    default:
      return queueNames.aiGenerate;
  }
}
