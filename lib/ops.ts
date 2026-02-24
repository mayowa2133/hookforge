import { Queue } from "bullmq";
import { prisma } from "./prisma";
import { queueConnection, queueNames, type QueueName } from "./queue";

type DurationRow = {
  createdAt: Date;
  updatedAt: Date;
  status: string;
};

export function computePercentile(values: number[], percentile: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const p = Math.max(0, Math.min(100, percentile));
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function summarizeSloMetrics(input: {
  renderRows: DurationRow[];
  aiRows: DurationRow[];
}) {
  const renderDurations = input.renderRows.map((row) => Math.max(0, row.updatedAt.getTime() - row.createdAt.getTime()));
  const aiDurations = input.aiRows.map((row) => Math.max(0, row.updatedAt.getTime() - row.createdAt.getTime()));

  const renderSuccess = input.renderRows.filter((row) => row.status === "DONE").length;
  const aiSuccess = input.aiRows.filter((row) => row.status === "DONE").length;

  return {
    render: {
      total: input.renderRows.length,
      success: renderSuccess,
      successRatePct: input.renderRows.length > 0 ? Number(((renderSuccess / input.renderRows.length) * 100).toFixed(2)) : 100,
      p95LatencyMs: computePercentile(renderDurations, 95)
    },
    ai: {
      total: input.aiRows.length,
      success: aiSuccess,
      successRatePct: input.aiRows.length > 0 ? Number(((aiSuccess / input.aiRows.length) * 100).toFixed(2)) : 100,
      p95LatencyMs: computePercentile(aiDurations, 95)
    }
  };
}

export async function getSloSummary(params: {
  workspaceId: string;
  windowHours?: number;
}) {
  const windowHours = Math.max(1, Math.min(24 * 30, params.windowHours ?? 24));
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  const [renderRows, aiRows] = await Promise.all([
    prisma.renderJob.findMany({
      where: {
        project: {
          workspaceId: params.workspaceId
        },
        createdAt: {
          gte: since
        }
      },
      select: {
        status: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.aIJob.findMany({
      where: {
        workspaceId: params.workspaceId,
        createdAt: {
          gte: since
        }
      },
      select: {
        status: true,
        createdAt: true,
        updatedAt: true
      }
    })
  ]);

  return {
    since,
    windowHours,
    ...summarizeSloMetrics({
      renderRows,
      aiRows
    })
  };
}

export async function getQueueHealth() {
  const names = Object.values(queueNames) as QueueName[];
  const queueHealth = await Promise.all(
    names.map(async (name) => {
      const queue = new Queue(name, { connection: queueConnection });
      try {
        const counts = await queue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
        return {
          name,
          counts,
          backlog: (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0),
          healthy: (counts.failed ?? 0) < 200
        };
      } finally {
        await queue.close();
      }
    })
  );

  return {
    queues: queueHealth,
    healthy: queueHealth.every((entry) => entry.healthy)
  };
}
