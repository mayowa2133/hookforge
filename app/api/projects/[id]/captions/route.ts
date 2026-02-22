import { z } from "zod";
import { requireProjectContext } from "@/lib/api-context";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const QuerySchema = z.object({
  language: z.string().min(2).max(12).optional()
});

export async function GET(request: Request, { params }: Context) {
  try {
    const query = QuerySchema.parse({
      language: new URL(request.url).searchParams.get("language") ?? undefined
    });
    const ctx = await requireProjectContext(params.id);

    const [captions, transcript] = await Promise.all([
      prisma.captionSegment.findMany({
        where: {
          projectId: ctx.projectV2.id,
          language: query.language ?? undefined
        },
        orderBy: [{ language: "asc" }, { startMs: "asc" }]
      }),
      prisma.transcriptWord.findMany({
        where: {
          projectId: ctx.projectV2.id
        },
        orderBy: {
          startMs: "asc"
        }
      })
    ]);

    const byLanguage: Record<string, typeof captions> = {};
    for (const caption of captions) {
      if (!byLanguage[caption.language]) {
        byLanguage[caption.language] = [];
      }
      byLanguage[caption.language].push(caption);
    }

    return jsonOk({
      requestProjectId: params.id,
      projectId: ctx.projectV2.id,
      captions,
      byLanguage,
      transcriptWords: transcript
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
