import { NextResponse } from "next/server";
import { jsonError, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { buildSamlMetadataXml } from "@/lib/sso";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const providerId = url.searchParams.get("providerId")?.trim();
    const workspaceSlug = url.searchParams.get("workspaceSlug")?.trim();

    if (!providerId && !workspaceSlug) {
      return jsonError("Provide providerId or workspaceSlug", 400);
    }

    const provider = await prisma.identityProviderConfig.findFirst({
      where: {
        ...(providerId ? { id: providerId } : {}),
        ...(workspaceSlug
          ? {
              workspace: {
                slug: workspaceSlug
              }
            }
          : {}),
        type: "SAML",
        enabled: true
      },
      include: {
        workspace: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    if (!provider) {
      return jsonError("SAML provider not found", 404);
    }

    const entityId = provider.samlEntityId || `${provider.workspace.slug}:${provider.id}`;
    const acsUrl = `${new URL(request.url).origin}/api/auth/sso/saml/acs`;
    const ssoUrl = provider.samlSsoUrl || provider.issuerUrl || `${new URL(request.url).origin}/api/auth/sso/saml/acs`;

    const metadata = buildSamlMetadataXml({
      entityId,
      acsUrl,
      ssoUrl
    });

    return new NextResponse(metadata, {
      status: 200,
      headers: {
        "Content-Type": "application/samlmetadata+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300"
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
