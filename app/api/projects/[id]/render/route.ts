import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAndEnqueueRenderJob } from "@/lib/render/enqueue";
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

    const renderJob = await createAndEnqueueRenderJob({
      projectId: params.id,
      userId: user.id
    });

    return NextResponse.json({ renderJob }, { status: 202 });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
