import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { routeErrorToResponse } from "@/lib/http";
import {
  ingestMobileTelemetryEvents,
  MobileTelemetryIngestSchema,
  readMobileTelemetrySnapshot,
  summarizeMobileTelemetry
} from "@/lib/mobile/telemetry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = MobileTelemetryIngestSchema.parse(await request.json());
    await ingestMobileTelemetryEvents(body.events);

    const snapshot = await readMobileTelemetrySnapshot();
    const summary = summarizeMobileTelemetry(snapshot);

    return NextResponse.json({
      ingested: body.events.length,
      crashFreeSessionsPct: summary.crashFreeSessionsPct,
      topWorkflowGapPct: summary.topWorkflowGapPct
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
