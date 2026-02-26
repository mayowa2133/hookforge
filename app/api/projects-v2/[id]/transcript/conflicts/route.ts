import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { listTranscriptConflictIssues } from "@/lib/transcript/document";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Context) {
  try {
    const url = new URL(request.url);
    return jsonOk(
      await listTranscriptConflictIssues(params.id, {
        language: url.searchParams.get("language") ?? undefined,
        issueType: (url.searchParams.get("issueType") as "LOW_CONFIDENCE" | "OVERLAP" | "TIMING_DRIFT" | null) ?? undefined,
        severity: (url.searchParams.get("severity") as "INFO" | "WARN" | "HIGH" | "CRITICAL" | null) ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined
      })
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
