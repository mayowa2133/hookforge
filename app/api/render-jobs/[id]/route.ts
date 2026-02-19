import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDownloadPresignedUrl } from "@/lib/storage";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const renderJob = await prisma.renderJob.findFirst({
    where: {
      id: params.id,
      project: {
        userId: user.id
      }
    },
    include: {
      project: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });

  if (!renderJob) {
    return NextResponse.json({ error: "Render job not found" }, { status: 404 });
  }

  return NextResponse.json({
    renderJob: {
      ...renderJob,
      outputUrl: renderJob.outputStorageKey ? await getDownloadPresignedUrl(renderJob.outputStorageKey) : null
    }
  });
}
