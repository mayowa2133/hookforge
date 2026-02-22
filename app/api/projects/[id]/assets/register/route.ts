import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
import { resolveLegacyProjectIdForUser } from "@/lib/project-id-bridge";
import { registerProjectAssetForUser, RegisterAssetInputSchema } from "@/lib/assets/register";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = RegisterAssetInputSchema.parse(await request.json());
    const legacyProjectId = await resolveLegacyProjectIdForUser({
      projectIdOrV2Id: params.id,
      userId: user.id
    });

    if (!legacyProjectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const result = await registerProjectAssetForUser({
      userId: user.id,
      projectId: legacyProjectId,
      input: body
    });

    return NextResponse.json(result);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
