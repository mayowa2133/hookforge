import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const TakedownSchema = z
  .object({
    sourceUrl: z.string().url().optional(),
    mediaAssetId: z.string().min(1).optional(),
    reason: z.string().min(8).max(800),
    notes: z.string().max(2000).optional()
  })
  .refine((value) => Boolean(value.sourceUrl || value.mediaAssetId), {
    message: "Provide sourceUrl or mediaAssetId"
  });

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const body = TakedownSchema.parse(await request.json());

    const sourceUrl = body.sourceUrl ? new URL(body.sourceUrl).toString() : undefined;

    const updateByUrlPromise = sourceUrl
      ? prisma.ingestionSourceLink.updateMany({
          where: {
            sourceUrl,
            mediaAsset: {
              workspaceId: workspace.id
            }
          },
          data: {
            rightsAttested: false
          }
        })
      : Promise.resolve({ count: 0 });

    const updateByAssetPromise = body.mediaAssetId
      ? prisma.ingestionSourceLink.updateMany({
          where: {
            mediaAssetId: body.mediaAssetId,
            mediaAsset: {
              workspaceId: workspace.id
            }
          },
          data: {
            rightsAttested: false
          }
        })
      : Promise.resolve({ count: 0 });

    const [updatedByUrl, updatedByAsset] = await Promise.all([updateByUrlPromise, updateByAssetPromise]);
    const affectedLinks = updatedByUrl.count + updatedByAsset.count;

    const flaggedEvent = await prisma.trustEvent.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        eventType: "CONTENT_FLAGGED",
        severity: "WARN",
        summary: "Content flagged for takedown review",
        metadata: {
          sourceUrl: sourceUrl ?? null,
          mediaAssetId: body.mediaAssetId ?? null,
          reason: body.reason,
          notes: body.notes ?? null,
          affectedLinks
        }
      }
    });

    const takedownEvent = await prisma.trustEvent.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        eventType: "CONTENT_TAKEDOWN",
        severity: "HIGH",
        summary: "Takedown recorded and source links disabled",
        metadata: {
          sourceUrl: sourceUrl ?? null,
          mediaAssetId: body.mediaAssetId ?? null,
          reason: body.reason,
          notes: body.notes ?? null,
          affectedLinks,
          flaggedEventId: flaggedEvent.id
        }
      }
    });

    return jsonOk(
      {
        status: "RECORDED",
        affectedLinks,
        flaggedEventId: flaggedEvent.id,
        takedownEventId: takedownEvent.id
      },
      201
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
