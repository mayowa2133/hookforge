import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
import { readMobileTelemetrySnapshot, summarizeMobileTelemetry } from "@/lib/mobile/telemetry";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const snapshot = await readMobileTelemetrySnapshot();
    const summary = summarizeMobileTelemetry(snapshot);

    return NextResponse.json({
      workflows: summary.workflowSummaries,
      topWorkflowGapPct: summary.topWorkflowGapPct,
      targetGapPct: 10
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
