import { NextResponse } from "next/server";
import { requireProjectContext } from "@/lib/api-context";
import { routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { buildTimelineState } from "@/lib/timeline-legacy";
import { getDownloadPresignedUrl } from "@/lib/storage";
import { getTranscript } from "@/lib/transcript/service";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await requireProjectContext(params.id);
    const [legacyProject, mediaAssets] = await Promise.all([
      prisma.project.findUnique({
        where: {
          id: ctx.legacyProject.id
        },
        include: {
          template: {
            select: {
              id: true,
              slug: true,
              name: true,
              slotSchema: true
            }
          },
          assets: true,
          renderJobs: {
            orderBy: { createdAt: "desc" },
            take: 10
          }
        }
      }),
      prisma.mediaAsset.findMany({
        where: {
          projectId: ctx.projectV2.id
        },
        orderBy: {
          createdAt: "asc"
        }
      })
    ]);

    if (!legacyProject) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const [assetsWithUrls, transcript] = await Promise.all([
      Promise.all(
        legacyProject.assets.map(async (asset) => ({
          ...asset,
          signedUrl: await getDownloadPresignedUrl(asset.storageKey)
        }))
      ),
      getTranscript(ctx.projectV2.id).catch(() => null)
    ]);

    const timeline = buildTimelineState(legacyProject.config, legacyProject.assets as never);

    return NextResponse.json({
      project: {
        id: ctx.projectV2.id,
        title: ctx.projectV2.title,
        status: ctx.projectV2.status,
        creationMode: legacyProject.template.slug === "__system_freeform_editor" ? "FREEFORM" : "QUICK_START",
        hasLegacyBridge: true,
        legacyProjectId: legacyProject.id
      },
      legacyProject: {
        id: legacyProject.id,
        title: legacyProject.title,
        status: legacyProject.status,
        template: legacyProject.template
      },
      assets: assetsWithUrls,
      mediaAssets,
      timeline: {
        timeline,
        revisionId: timeline.revisions[0]?.id ?? null,
        revision: timeline.version
      },
      transcript
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
