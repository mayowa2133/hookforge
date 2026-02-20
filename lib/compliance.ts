import { prisma } from "./prisma";
import { validateImportUrl } from "./media-import";

export type ComplianceSourceType = "WEBSITE" | "YOUTUBE" | "REDDIT" | "OTHER";

function normalizeHost(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function detectSourceTypeFromUrl(rawUrl: string): ComplianceSourceType {
  const parsed = validateImportUrl(rawUrl);
  const host = normalizeHost(parsed.hostname);

  if (host.includes("youtube.com") || host === "youtu.be") {
    return "YOUTUBE";
  }
  if (host.includes("reddit.com") || host === "redd.it") {
    return "REDDIT";
  }
  if (host.length > 0) {
    return "WEBSITE";
  }
  return "OTHER";
}

export async function createSourceAttestation(params: {
  workspaceId: string;
  userId: string;
  sourceUrl: string;
  sourceType?: ComplianceSourceType;
  statement: string;
  flow: string;
}) {
  const parsed = validateImportUrl(params.sourceUrl);
  const canonicalUrl = `${parsed.origin}${parsed.pathname}`;
  const sourceType = params.sourceType ?? detectSourceTypeFromUrl(parsed.toString());

  return prisma.$transaction(async (tx) => {
    const mediaAsset = await tx.mediaAsset.create({
      data: {
        workspaceId: params.workspaceId,
        source: "URL_IMPORT",
        storageKey: `imports/pending/${params.workspaceId}/${Date.now()}`,
        mimeType: "application/octet-stream"
      }
    });

    const rightsAttestation = await tx.rightsAttestation.create({
      data: {
        workspaceId: params.workspaceId,
        userId: params.userId,
        sourceType,
        sourceUrl: parsed.toString(),
        statement: params.statement,
        acceptedAt: new Date(),
        metadata: {
          flow: params.flow
        }
      }
    });

    const sourceLink = await tx.ingestionSourceLink.create({
      data: {
        mediaAssetId: mediaAsset.id,
        sourceType,
        sourceUrl: parsed.toString(),
        canonicalUrl,
        rightsAttested: true,
        importedByUserId: params.userId
      }
    });

    const trustEvent = await tx.trustEvent.create({
      data: {
        workspaceId: params.workspaceId,
        userId: params.userId,
        eventType: "RIGHTS_ATTESTED",
        severity: "INFO",
        summary: `Rights attestation accepted for ${parsed.hostname}`,
        metadata: {
          flow: params.flow,
          sourceType,
          rightsAttestationId: rightsAttestation.id,
          ingestionSourceLinkId: sourceLink.id,
          mediaAssetId: mediaAsset.id
        }
      }
    });

    return {
      parsed,
      sourceType,
      mediaAsset,
      rightsAttestation,
      sourceLink,
      trustEvent
    };
  });
}
