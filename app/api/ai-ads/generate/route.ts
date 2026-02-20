import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { buildDeterministicAdScript, estimatePhase4AdsCredits } from "@/lib/ai/phase4";
import { createSourceAttestation } from "@/lib/compliance";
import { reserveCredits } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { validateImportUrl } from "@/lib/media-import";
import { ensureProjectV2FromLegacy } from "@/lib/project-v2";
import { prisma } from "@/lib/prisma";
import { getDefaultConfigFromTemplate } from "@/lib/template-runtime";

export const runtime = "nodejs";

const GenerateAdSchema = z.object({
  websiteUrl: z.string().url(),
  productName: z.string().max(160).optional(),
  actorId: z.string().min(1).optional(),
  voiceId: z.string().min(1).optional(),
  tone: z.string().max(80).default("ugc"),
  durationSec: z.number().min(10).max(120).default(30),
  rightsAttested: z.boolean(),
  statement: z.string().min(12).max(600)
});

export async function POST(request: Request) {
  try {
    const body = GenerateAdSchema.parse(await request.json());
    const parsedUrl = validateImportUrl(body.websiteUrl);
    const { user, workspace } = await requireUserWithWorkspace();

    if (!body.rightsAttested) {
      throw new Error("rightsAttested must be true");
    }

    const template = await prisma.template.findUnique({
      where: {
        slug: "green-screen-commentator"
      }
    });
    if (!template) {
      throw new Error("Template not found: green-screen-commentator");
    }

    const script = buildDeterministicAdScript({
      websiteUrl: parsedUrl.toString(),
      productName: body.productName,
      tone: body.tone
    });

    const legacyProject = await prisma.project.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        templateId: template.id,
        title: body.productName ? `AI Ad: ${body.productName}` : `AI Ad: ${script.product}`,
        status: "DRAFT",
        config: {
          ...getDefaultConfigFromTemplate(template),
          captionText: script.hook
        }
      }
    });

    const project = await ensureProjectV2FromLegacy({
      legacyProjectId: legacyProject.id,
      workspaceId: workspace.id,
      createdByUserId: user.id,
      title: legacyProject.title,
      status: legacyProject.status
    });

    const attestation = await createSourceAttestation({
      workspaceId: workspace.id,
      userId: user.id,
      sourceUrl: parsedUrl.toString(),
      sourceType: "WEBSITE",
      statement: body.statement,
      flow: "ai-ads-generate"
    });

    const aiJob = await enqueueAIJob({
      workspaceId: workspace.id,
      projectId: project.id,
      type: "AI_ADS",
      queueName: queueNameForJobType("AI_ADS"),
      input: {
        ...body,
        websiteUrl: parsedUrl.toString(),
        sourceType: "WEBSITE",
        rightsAttestationId: attestation.rightsAttestation.id,
        ingestionSourceLinkId: attestation.sourceLink.id,
        legacyProjectId: legacyProject.id
      }
    });

    const credits = estimatePhase4AdsCredits({
      durationSec: body.durationSec,
      hasVoice: Boolean(body.voiceId)
    });

    await reserveCredits({
      workspaceId: workspace.id,
      feature: "ai_ads.generate",
      amount: credits,
      referenceType: "AIJob",
      referenceId: aiJob.id,
      metadata: {
        websiteUrl: parsedUrl.toString(),
        tone: body.tone
      }
    });

    return jsonOk(
      {
        adProjectId: project.id,
        legacyProjectId: legacyProject.id,
        projectEditorPath: `/projects/${legacyProject.id}`,
        aiJobId: aiJob.id,
        status: aiJob.status,
        editableScript: script,
        editableMedia: [],
        creditEstimate: credits
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
