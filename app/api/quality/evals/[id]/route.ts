import { requireCurrentUser } from "@/lib/auth";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(_request: Request, { params }: Context) {
  try {
    await requireCurrentUser();

    const evalRun = await prisma.qualityEvalRun.findUnique({
      where: { id: params.id },
      include: {
        modelVersion: true,
        createdBy: {
          select: {
            id: true,
            email: true
          }
        }
      }
    });

    if (!evalRun) {
      throw new Error("Quality eval run not found");
    }

    return jsonOk({ evalRun });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
