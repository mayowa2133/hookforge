import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { assertUrlImportEnabled, parseSourceType, validateImportUrl } from "@/lib/media-import";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const ImportSchema = z.object({
  sourceUrl: z.string().url(),
  sourceType: z.enum(["WEBSITE", "YOUTUBE", "REDDIT", "OTHER"]).default("OTHER"),
  rightsAttested: z.boolean(),
  statement: z.string().min(12).max(600)
});

export async function POST(request: Request) {
  try {
    assertUrlImportEnabled();
    const { user, workspace } = await requireUserWithWorkspace();
    const body = ImportSchema.parse(await request.json());

    if (!body.rightsAttested) {
      return jsonError("rightsAttested must be true", 400);
    }

    const parsed = validateImportUrl(body.sourceUrl);
    const sourceType = parseSourceType(body.sourceType);

    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        workspaceId: workspace.id,
        source: "URL_IMPORT",
        storageKey: `imports/pending/${workspace.id}/${Date.now()}`,
        mimeType: "application/octet-stream"
      }
    });

    const rights = await prisma.rightsAttestation.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        sourceType,
        sourceUrl: parsed.toString(),
        statement: body.statement,
        acceptedAt: new Date(),
        metadata: {
          flow: "import-url"
        }
      }
    });

    await prisma.ingestionSourceLink.create({
      data: {
        mediaAssetId: mediaAsset.id,
        sourceType,
        sourceUrl: parsed.toString(),
        canonicalUrl: parsed.origin + parsed.pathname,
        rightsAttested: true,
        importedByUserId: user.id
      }
    });

    await prisma.trustEvent.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        eventType: "RIGHTS_ATTESTED",
        severity: "INFO",
        summary: `URL import attestation accepted for ${parsed.hostname}`,
        metadata: {
          rightsAttestationId: rights.id,
          mediaAssetId: mediaAsset.id
        }
      }
    });

    const aiJob = await enqueueAIJob({
      workspaceId: workspace.id,
      type: "INGEST_URL",
      queueName: queueNameForJobType("INGEST_URL"),
      input: {
        mediaAssetId: mediaAsset.id,
        sourceUrl: parsed.toString(),
        sourceType
      }
    });

    return jsonOk(
      {
        ingestionJobId: aiJob.id,
        mediaAssetId: mediaAsset.id,
        status: aiJob.status
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
