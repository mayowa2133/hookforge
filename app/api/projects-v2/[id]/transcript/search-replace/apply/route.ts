import { z } from "zod";
import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { applyTranscriptSearchReplace } from "@/lib/transcript/document";

export const runtime = "nodejs";

type Context = {
  params: { id: string };
};

const SearchReplaceSchema = z.object({
  language: z.string().trim().min(2).max(12).default("en"),
  search: z.string().trim().min(1).max(120),
  replace: z.string().max(240),
  caseSensitive: z.boolean().default(false),
  maxSegments: z.number().int().min(1).max(2000).default(500)
});

export async function POST(request: Request, { params }: Context) {
  try {
    const body = SearchReplaceSchema.parse(await request.json());
    return jsonOk(await applyTranscriptSearchReplace(params.id, body));
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
