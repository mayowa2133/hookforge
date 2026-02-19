import { requireUserWithWorkspace } from "@/lib/api-context";
import { demoActorPresets } from "@/lib/ai/phase3";
import { routeErrorToResponse, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireUserWithWorkspace();

    return jsonOk({
      actors: demoActorPresets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        previewVideo: `/demo-assets/${preset.foregroundFile}`,
        previewBackground: `/demo-assets/${preset.backgroundFile}`
      })),
      complianceNote: "AI actors and clones are only available for consented identities and owned rights-safe media."
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
