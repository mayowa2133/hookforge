import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { demoActorPresets, estimatePhase3Credits } from "@/lib/ai/phase3";
import { rankCreatorCandidates } from "@/lib/ai/phase4-quality";
import { reserveCredits } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { ensureProjectV2FromLegacy } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { getDefaultConfigFromTemplate } from "@/lib/template-runtime";
import { sanitizeOverlayText } from "@/lib/sanitize";

export const runtime = "nodejs";

const GenerateSchema = z
  .object({
    script: z.string().max(6000).optional(),
    prompt: z.string().max(3000).optional(),
    audioAssetId: z.string().min(1).optional(),
    actorId: z.string().min(1).optional(),
    voiceId: z.string().min(1).optional(),
    twinId: z.string().min(1).optional(),
    style: z.string().max(80).default("creator-default"),
    durationSec: z.number().min(3).max(180).default(30),
    templateSlug: z.string().min(2).max(120).default("green-screen-commentator"),
    title: z.string().min(2).max(120).optional()
  })
  .refine((value) => Boolean(value.script || value.prompt || value.audioAssetId), {
    message: "Provide at least one of script, prompt, or audioAssetId"
  });

export async function POST(request: Request) {
  try {
    const body = GenerateSchema.parse(await request.json());
    const { user, workspace } = await requireUserWithWorkspace();
    const creatorScript = sanitizeOverlayText(
      body.script?.trim() || body.prompt?.trim() || "HookForge AI Creator draft",
      "HookForge AI Creator draft"
    );
    const creatorRanking = rankCreatorCandidates({
      script: creatorScript,
      durationSec: body.durationSec,
      actors: demoActorPresets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description
      })),
      requestedActorId: body.actorId
    });

    const template = await prisma.template.findUnique({
      where: {
        slug: body.templateSlug
      }
    });
    if (!template) {
      throw new Error("Template not found");
    }

    if (body.voiceId) {
      const voiceProfile = await prisma.voiceProfile.findFirst({
        where: {
          id: body.voiceId,
          workspaceId: workspace.id
        },
        include: {
          voiceClones: {
            select: {
              status: true
            }
          }
        }
      });
      if (!voiceProfile) {
        throw new Error("Voice profile not found");
      }
      if (voiceProfile.voiceClones.length > 0 && !voiceProfile.voiceClones.some((clone) => clone.status === "VERIFIED")) {
        throw new Error("Voice profile clone consent must be VERIFIED before generation");
      }
    }

    if (body.twinId) {
      const twin = await prisma.aITwin.findFirst({
        where: {
          id: body.twinId,
          workspaceId: workspace.id
        },
        select: {
          id: true,
          status: true
        }
      });
      if (!twin) {
        throw new Error("AI twin not found");
      }
      if (twin.status !== "VERIFIED") {
        throw new Error("AI twin must be VERIFIED before generation");
      }
    }

    const legacyProject = await prisma.project.create({
      data: {
        userId: user.id,
        templateId: template.id,
        workspaceId: workspace.id,
        title: body.title ?? `AI Creator: ${template.name}`,
        status: "DRAFT",
        config: getDefaultConfigFromTemplate(template)
      }
    });

    const project = await ensureProjectV2FromLegacy({
      legacyProjectId: legacyProject.id,
      workspaceId: workspace.id,
      createdByUserId: user.id,
      title: legacyProject.title,
      status: legacyProject.status
    });

    const aiJob = await enqueueAIJob({
      workspaceId: workspace.id,
      projectId: project.id,
      type: "AI_CREATOR",
      queueName: queueNameForJobType("AI_CREATOR"),
      input: {
        ...body,
        actorId: body.actorId ?? creatorRanking.selected.actorId,
        creatorCandidateRanking: creatorRanking,
        legacyProjectId: legacyProject.id
      }
    });

    const estimatedCredits = estimatePhase3Credits({
      durationSec: body.durationSec,
      withTwin: Boolean(body.twinId),
      withVoice: Boolean(body.voiceId),
      hasAudioInput: Boolean(body.audioAssetId)
    });

    await reserveCredits({
      workspaceId: workspace.id,
      feature: "ai_creator.generate",
      amount: estimatedCredits,
      referenceType: "AIJob",
      referenceId: aiJob.id,
      metadata: {
        durationSec: body.durationSec,
        actorId: body.actorId ?? null,
        voiceId: body.voiceId ?? null,
        twinId: body.twinId ?? null
      }
    });

    return jsonOk(
      {
        generatedProjectId: project.id,
        legacyProjectId: legacyProject.id,
        projectEditorPath: `/projects/${legacyProject.id}`,
        artifacts: [],
        aiJobId: aiJob.id,
        status: aiJob.status,
        selectedCandidate: creatorRanking.selected,
        rankedCandidates: creatorRanking.candidates,
        qualitySummary: creatorRanking.qualitySummary,
        creditEstimate: estimatedCredits
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
