import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
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
    const result = await registerProjectAssetForUser({
      userId: user.id,
      projectId: params.id,
      input: body
    });

    return NextResponse.json(result);
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
