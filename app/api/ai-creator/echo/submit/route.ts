import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { enqueueAIJob, queueNameForJobType } from "@/lib/ai/jobs";
import { estimatePhase3Credits, nextConsentStatus } from "@/lib/ai/phase3";
import { reserveCredits } from "@/lib/credits";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const EchoSubmitSchema = z.object({
  name: z.string().min(2).max(80),
  language: z.string().min(2).max(12).default("en"),
  sampleStorageKey: z.string().min(8),
  scriptSample: z.string().max(500).optional(),
  consent: z.object({
    subjectName: z.string().min(2).max(120),
    subjectEmail: z.string().email().optional(),
    verified: z.boolean()
  })
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const body = EchoSubmitSchema.parse(await request.json());

    if (!body.sampleStorageKey.startsWith(`voice-samples/${workspace.id}/`)) {
      throw new Error("Echo sample key is not in this workspace namespace");
    }

    const status = nextConsentStatus(body.consent.verified);

    const created = await prisma.$transaction(async (tx) => {
      const consent = await tx.consentVerification.create({
        data: {
          workspaceId: workspace.id,
          subjectType: "VOICE_CLONE_ECHO",
          subjectName: body.consent.subjectName,
          subjectEmail: body.consent.subjectEmail,
          status,
          evidenceStorageKey: body.sampleStorageKey,
          reviewedByUserId: body.consent.verified ? user.id : null,
          verifiedAt: body.consent.verified ? new Date() : null
        }
      });

      const voiceProfile = await tx.voiceProfile.create({
        data: {
          workspaceId: workspace.id,
          name: body.name,
          provider: "echo-record",
          language: body.language
        }
      });

      const voiceClone = await tx.voiceClone.create({
        data: {
          workspaceId: workspace.id,
          voiceProfileId: voiceProfile.id,
          consentVerificationId: consent.id,
          status,
          sampleStorageKey: body.sampleStorageKey
        }
      });

      await tx.trustEvent.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          eventType: "CONSENT_SUBMITTED",
          severity: body.consent.verified ? "INFO" : "WARN",
          summary: `AI Echo sample submitted for ${body.name}`,
          metadata: {
            voiceProfileId: voiceProfile.id,
            voiceCloneId: voiceClone.id,
            consentVerificationId: consent.id,
            sampleStorageKey: body.sampleStorageKey
          }
        }
      });

      if (body.consent.verified) {
        await tx.trustEvent.create({
          data: {
            workspaceId: workspace.id,
            userId: user.id,
            eventType: "CONSENT_VERIFIED",
            severity: "INFO",
            summary: `AI Echo consent verified for ${body.name}`,
            metadata: {
              voiceProfileId: voiceProfile.id,
              voiceCloneId: voiceClone.id,
              consentVerificationId: consent.id
            }
          }
        });
      }

      return { consent, voiceProfile, voiceClone };
    });

    const aiJob = await enqueueAIJob({
      workspaceId: workspace.id,
      type: "AI_CREATOR",
      queueName: queueNameForJobType("AI_CREATOR"),
      input: {
        mode: "echo_voice",
        voiceProfileId: created.voiceProfile.id,
        voiceCloneId: created.voiceClone.id,
        sampleStorageKey: body.sampleStorageKey,
        scriptSample: body.scriptSample ?? ""
      }
    });

    const estimatedCredits = estimatePhase3Credits({
      durationSec: 8,
      withTwin: false,
      withVoice: true,
      hasAudioInput: true
    });

    await reserveCredits({
      workspaceId: workspace.id,
      feature: "ai_creator.echo",
      amount: estimatedCredits,
      referenceType: "AIJob",
      referenceId: aiJob.id,
      metadata: {
        voiceProfileId: created.voiceProfile.id,
        voiceCloneId: created.voiceClone.id
      }
    });

    return jsonOk(
      {
        voiceProfile: created.voiceProfile,
        voiceClone: created.voiceClone,
        consent: created.consent,
        aiJobId: aiJob.id,
        status: aiJob.status,
        creditEstimate: estimatedCredits
      },
      202
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
