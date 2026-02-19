import { Queue } from "bullmq";
import { env } from "./env";
import { queueNames, type QueueName } from "./queue-names";

export { queueNames, type QueueName };

export const renderQueueName = queueNames.renderProject;

const redisUrl = new URL(env.REDIS_URL);

const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  tls: redisUrl.protocol === "rediss:" ? {} : undefined,
  maxRetriesPerRequest: null as number | null
};

declare global {
  // eslint-disable-next-line no-var
  var __hookforgeQueues: Map<string, Queue> | undefined;
}

function getGlobalQueues() {
  if (!global.__hookforgeQueues) {
    global.__hookforgeQueues = new Map<string, Queue>();
  }
  return global.__hookforgeQueues;
}

export function getQueue(name: QueueName) {
  const cache = getGlobalQueues();
  const existing = cache.get(name);
  if (existing) {
    return existing;
  }

  const queue = new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: 100,
      removeOnFail: 200,
      backoff: {
        type: "exponential",
        delay: 1000
      }
    }
  });

  cache.set(name, queue);
  return queue;
}

export const renderQueue = getQueue(renderQueueName);
export const ingestQueue = getQueue(queueNames.ingest);
export const transcribeQueue = getQueue(queueNames.transcribe);
export const translateQueue = getQueue(queueNames.translate);
export const dubLipSyncQueue = getQueue(queueNames.dubLipSync);
export const aiEditQueue = getQueue(queueNames.aiEdit);
export const aiGenerateQueue = getQueue(queueNames.aiGenerate);
export const billingMeterQueue = getQueue(queueNames.billingMeter);

export const queueConnection = connection;
