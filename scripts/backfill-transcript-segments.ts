import "dotenv/config";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { assignSegmentIdsToWords, buildTranscriptSegmentsFromWords } from "../lib/transcript/segmentation";

async function main() {
  const projects = await prisma.projectV2.findMany({
    select: {
      id: true
    }
  });

  let seededFromCaptions = 0;
  let seededFromWords = 0;
  let updatedWordLinks = 0;

  for (const project of projects) {
    const existingCount = await prisma.transcriptSegment.count({
      where: {
        projectId: project.id
      }
    });
    if (existingCount > 0) {
      continue;
    }

    const [captions, words] = await Promise.all([
      prisma.captionSegment.findMany({
        where: {
          projectId: project.id
        },
        orderBy: [{ language: "asc" }, { startMs: "asc" }]
      }),
      prisma.transcriptWord.findMany({
        where: {
          projectId: project.id
        },
        orderBy: {
          startMs: "asc"
        }
      })
    ]);

    if (captions.length > 0) {
      const segments = captions.map((caption) => ({
        id: randomUUID(),
        projectId: project.id,
        language: caption.language,
        text: caption.text,
        startMs: caption.startMs,
        endMs: caption.endMs,
        speakerLabel: null,
        confidenceAvg: null,
        source: "BACKFILL"
      }));

      await prisma.transcriptSegment.createMany({
        data: segments
      });
      seededFromCaptions += segments.length;

      if (words.length > 0) {
        const preferredLanguage = segments[0]?.language ?? "en";
        const languageSegments = segments.filter((segment) => segment.language === preferredLanguage);
        const withSegmentIds = assignSegmentIdsToWords(words, languageSegments);
        await prisma.$transaction(
          withSegmentIds
            .filter((word) => word.segmentId)
            .map((word) =>
              prisma.transcriptWord.update({
                where: { id: word.id! },
                data: { segmentId: word.segmentId }
              })
            )
        );
        updatedWordLinks += withSegmentIds.filter((word) => word.segmentId).length;
      }
      continue;
    }

    if (words.length === 0) {
      continue;
    }

    const segments = buildTranscriptSegmentsFromWords(words).map((segment) => ({
      id: randomUUID(),
      projectId: project.id,
      language: "en",
      text: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      speakerLabel: segment.speakerLabel ?? null,
      confidenceAvg: segment.confidenceAvg ?? null,
      source: "BACKFILL"
    }));

    await prisma.transcriptSegment.createMany({
      data: segments
    });
    seededFromWords += segments.length;

    const withSegmentIds = assignSegmentIdsToWords(words, segments);
    await prisma.$transaction(
      withSegmentIds
        .filter((word) => word.segmentId)
        .map((word) =>
          prisma.transcriptWord.update({
            where: { id: word.id! },
            data: { segmentId: word.segmentId }
          })
        )
    );
    updatedWordLinks += withSegmentIds.filter((word) => word.segmentId).length;
  }

  console.log(
    JSON.stringify(
      {
        scannedProjects: projects.length,
        seededFromCaptions,
        seededFromWords,
        updatedWordLinks
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
