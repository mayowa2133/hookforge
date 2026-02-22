import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAndEnqueueRenderJob } from "@/lib/render/enqueue";
import { resolveLegacyProjectIdForUser } from "@/lib/project-id-bridge";
import { routeErrorToResponse } from "@/lib/http";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(_request: Request, { params }: Context) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const legacyProjectId = await resolveLegacyProjectIdForUser({
      projectIdOrV2Id: params.id,
      userId: user.id
    });
    if (!legacyProjectId) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const renderJob = await createAndEnqueueRenderJob({
      projectId: legacyProjectId,
      userId: user.id
    });

    return NextResponse.json({ renderJob }, { status: 202 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
