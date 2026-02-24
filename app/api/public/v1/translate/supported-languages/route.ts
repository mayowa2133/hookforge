import { authenticatePublicApiKeyWithScope } from "@/lib/public-api";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { getSupportedLanguages } from "@/lib/languages";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authenticatePublicApiKeyWithScope(request, "translate.read");

    return jsonOk({
      languages: getSupportedLanguages()
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
