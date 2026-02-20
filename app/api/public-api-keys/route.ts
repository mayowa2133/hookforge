import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { generateApiKey, hashApiKey, makeApiKeyPrefix } from "@/lib/public-api";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const CreateApiKeySchema = z.object({
  name: z.string().min(2).max(80)
});

export async function GET() {
  try {
    const { workspace } = await requireUserWithWorkspace();
    const apiKeys = await prisma.publicApiKey.findMany({
      where: {
        workspaceId: workspace.id
      },
      orderBy: {
        createdAt: "desc"
      },
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
      workspaceId: workspace.id,
      apiKeys
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const body = CreateApiKeySchema.parse(await request.json());

    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = makeApiKeyPrefix(rawKey);

    const apiKey = await prisma.publicApiKey.create({
      data: {
        workspaceId: workspace.id,
        createdByUserId: user.id,
        name: body.name.trim(),
        keyPrefix,
        keyHash,
        status: "ACTIVE"
      },
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

    return jsonOk(
      {
        workspaceId: workspace.id,
        apiKey,
        secret: rawKey
      },
      201
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
