import { jsonOk, routeErrorToResponse } from "@/lib/http";
import { templateCatalog } from "@/lib/template-catalog";

export const runtime = "nodejs";

export async function GET() {
  try {
    const presets = templateCatalog.map((template) => ({
      id: template.slug,
      slug: template.slug,
      name: template.name,
      description: template.description,
      tags: template.tags
    }));

    return jsonOk({ presets });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
