import { requireUserWithWorkspace } from "@/lib/api-context";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: {
    id: string;
  };
};

export async function POST(_request: Request, { params }: Context) {
  try {
    const { workspace } = await requireUserWithWorkspace();
    const apiKey = await prisma.publicApiKey.findFirst({
      where: {
        id: params.id,
        workspaceId: workspace.id
      }
    });

    if (!apiKey) {
      return jsonError("API key not found", 404);
    }

    const updated = await prisma.publicApiKey.update({
      where: { id: apiKey.id },
      data: { status: "DISABLED" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        status: true,
        lastUsedAt: true,
        createdAt: true,
        updatedAt: true
      }
    });

    return jsonOk({
      apiKey: updated
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
