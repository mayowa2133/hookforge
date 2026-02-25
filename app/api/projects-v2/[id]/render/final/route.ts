import { NextResponse } from "next/server";
import { requireProjectContext } from "@/lib/api-context";
import { routeErrorToResponse } from "@/lib/http";
import { createAndEnqueueRenderJob } from "@/lib/render/enqueue";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function POST(_request: Request, { params }: Context) {
  try {
    const ctx = await requireProjectContext(params.id);
    const renderJob = await createAndEnqueueRenderJob({
      projectId: ctx.legacyProject.id,
      userId: ctx.user.id
    });

    return NextResponse.json({ renderJob }, { status: 202 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
