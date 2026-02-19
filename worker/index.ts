import "dotenv/config";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { RenderJobStatus } from "@prisma/client";
import { Worker } from "bullmq";
import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { queueConnection, queueNames, renderQueueName } from "../lib/queue";
import { mapProjectToRenderProps } from "../lib/render/props";
import { buildRenderOutputKey, getDownloadPresignedUrl, uploadBufferToStorage } from "../lib/storage";
import { suppressStorageVideoBackground } from "../lib/video-normalize";
import { processAIJob } from "../lib/ai/orchestrator";
import { logger } from "../lib/observability/logger";

let serveUrlPromise: Promise<string> | null = null;

async function getServeUrl() {
  if (!serveUrlPromise) {
    serveUrlPromise = bundle({
      entryPoint: join(process.cwd(), "remotion/index.ts")
    });
  }

  return serveUrlPromise;
}

async function updateProgress(renderJobId: string, progress: number) {
  try {
    await prisma.renderJob.update({
      where: { id: renderJobId },
      data: {
        progress: Math.max(0, Math.min(100, Math.floor(progress)))
      }
    });
  } catch (error) {
    // Progress writes are best-effort and should never crash rendering.
    console.warn(`Failed to persist render progress for ${renderJobId}`, error);
  }
}

function readBooleanConfig(config: unknown, key: string, fallback: boolean) {
  if (!config || typeof config !== "object" || !(key in config)) {
    return fallback;
  }
  return Boolean((config as Record<string, unknown>)[key]);
}

function readNumberConfig(config: unknown, key: string, fallback: number) {
  if (!config || typeof config !== "object" || !(key in config)) {
    return fallback;
  }
  const value = Number((config as Record<string, unknown>)[key]);
  return Number.isFinite(value) ? value : fallback;
}

function readStringConfig(config: unknown, key: string, fallback: string) {
  if (!config || typeof config !== "object" || !(key in config)) {
    return fallback;
  }
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : fallback;
}

const renderWorker = new Worker(
  renderQueueName,
  async (job) => {
    const renderJobId = String(job.data.renderJobId);

    const renderJob = await prisma.renderJob.findUnique({
      where: { id: renderJobId },
      include: {
        project: {
          include: {
            template: true,
            assets: true
          }
        }
      }
    });

    if (!renderJob) {
      throw new Error(`Render job ${renderJobId} not found`);
    }

    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: {
        status: RenderJobStatus.RUNNING,
        progress: 5,
        errorMessage: null
      }
    });

    await prisma.project.update({
      where: { id: renderJob.projectId },
      data: { status: "RENDERING" }
    });

    const renderAssets = [...renderJob.project.assets];
    const shouldRunForegroundCleanup =
      renderJob.project.template.slug === "green-screen-commentator" &&
      readBooleanConfig(renderJob.project.config, "subjectIsolation", true);

    if (shouldRunForegroundCleanup) {
      const foregroundIndex = renderAssets.findIndex((asset) => asset.slotKey === "foreground" && asset.kind === "VIDEO");
      if (foregroundIndex >= 0) {
        const foregroundAsset = renderAssets[foregroundIndex];
        await updateProgress(renderJob.id, 12);
        try {
          const suppressed = await suppressStorageVideoBackground({
            storageKey: foregroundAsset.storageKey,
            projectId: renderJob.project.id,
            slotKey: foregroundAsset.slotKey,
            width: foregroundAsset.width,
            height: foregroundAsset.height,
            mode: readStringConfig(renderJob.project.config, "subjectIsolationMode", "blur"),
            similarity: readNumberConfig(renderJob.project.config, "subjectIsolationSimilarity", 0.25),
            blend: readNumberConfig(renderJob.project.config, "subjectIsolationBlend", 0.08)
          });

          renderAssets[foregroundIndex] = {
            ...foregroundAsset,
            storageKey: suppressed.storageKey,
            mimeType: suppressed.mimeType,
            durationSec: suppressed.probe.durationSec,
            width: suppressed.probe.width,
            height: suppressed.probe.height
          };
          await updateProgress(renderJob.id, 18);
        } catch (cleanupError) {
          console.warn("Foreground background cleanup failed; rendering with original foreground asset.", cleanupError);
        }
      }
    }

    const signedAssets = await Promise.all(
      renderAssets.map(async (asset) => ({
        ...asset,
        signedUrl: await getDownloadPresignedUrl(asset.storageKey)
      }))
    );

    const renderPlan = mapProjectToRenderProps(
      renderJob.project.template,
      signedAssets,
      renderJob.project.config
    );

    const serveUrl = await getServeUrl();

    const composition = await selectComposition({
      serveUrl,
      id: renderPlan.compositionId,
      inputProps: renderPlan.inputProps
    });

    const outputPath = join(tmpdir(), `${renderJob.id}-${randomUUID()}.mp4`);
    let lastSavedProgress = 10;

    try {
      await renderMedia({
        serveUrl,
        composition,
        codec: "h264",
        outputLocation: outputPath,
        inputProps: renderPlan.inputProps,
        onProgress: (progressPayload: unknown) => {
          const progressValue =
            typeof progressPayload === "object" &&
            progressPayload !== null &&
            "progress" in progressPayload &&
            typeof (progressPayload as { progress: number }).progress === "number"
              ? (progressPayload as { progress: number }).progress
              : 0;

          const mappedProgress = Math.max(10, Math.min(95, Math.round(progressValue * 100)));
          if (mappedProgress - lastSavedProgress >= 4) {
            lastSavedProgress = mappedProgress;
            void updateProgress(renderJob.id, mappedProgress).catch((progressError) => {
              console.warn(`Progress update warning for ${renderJob.id}`, progressError);
            });
          }
        }
      });

      const outputBuffer = await readFile(outputPath);
      const outputStorageKey = buildRenderOutputKey(renderJob.project.id);
      await uploadBufferToStorage(outputStorageKey, outputBuffer, {
        ContentType: "video/mp4"
      });

      await prisma.renderJob.update({
        where: { id: renderJob.id },
        data: {
          status: RenderJobStatus.DONE,
          progress: 100,
          outputStorageKey,
          errorMessage: null
        }
      });

      await prisma.project.update({
        where: { id: renderJob.project.id },
        data: { status: "DONE" }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Render failed";

      await prisma.renderJob.update({
        where: { id: renderJob.id },
        data: {
          status: RenderJobStatus.ERROR,
          progress: 100,
          errorMessage: message
        }
      });

      await prisma.project.update({
        where: { id: renderJob.project.id },
        data: { status: "ERROR" }
      });

      throw error;
    } finally {
      await unlink(outputPath).catch(() => undefined);
    }
  },
  {
    connection: queueConnection,
    concurrency: 2
  }
);

renderWorker.on("ready", () => {
  console.log("HookForge worker is ready");
});

renderWorker.on("completed", (job) => {
  console.log(`Render job completed: ${job.id}`);
});

renderWorker.on("failed", (job, error) => {
  console.error(`Render job failed: ${job?.id}`, error);
});

const aiQueueNames = [
  queueNames.ingest,
  queueNames.transcribe,
  queueNames.captionStyle,
  queueNames.translate,
  queueNames.dubLipSync,
  queueNames.aiEdit,
  queueNames.aiGenerate,
  queueNames.billingMeter
];

const aiWorkers = aiQueueNames.map(
  (name) =>
    new Worker(
      name,
      async (job) => {
        const aiJobId = typeof job.data?.aiJobId === "string" ? job.data.aiJobId : "";
        if (!aiJobId) {
          throw new Error(`Missing aiJobId for queue ${name}`);
        }
        await processAIJob(aiJobId);
      },
      {
        connection: queueConnection,
        concurrency: 3
      }
    )
);

for (const aiWorker of aiWorkers) {
  aiWorker.on("ready", () => {
    logger.info("AI worker ready", { queue: aiWorker.name });
  });
  aiWorker.on("completed", (job) => {
    logger.info("AI worker job completed", { queue: aiWorker.name, jobId: job?.id });
  });
  aiWorker.on("failed", (job, error) => {
    logger.error("AI worker job failed", {
      queue: aiWorker.name,
      jobId: job?.id,
      message: error?.message
    });
  });
}

const shutdown = async () => {
  await Promise.all([renderWorker.close(), ...aiWorkers.map((aiWorker) => aiWorker.close())]);
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
