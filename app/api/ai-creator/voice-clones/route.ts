import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { nextConsentStatus } from "@/lib/ai/phase3";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const VoiceCloneSchema = z.object({
  name: z.string().min(2).max(80),
  language: z.string().min(2).max(12).default("en"),
  sampleStorageKey: z.string().min(8).optional(),
  provider: z.string().min(2).max(80).default("hookforge-local"),
  consent: z.object({
    subjectName: z.string().min(2).max(120),
    subjectEmail: z.string().email().optional(),
    verified: z.boolean().default(false)
  })
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const body = VoiceCloneSchema.parse(await request.json());

    if (body.sampleStorageKey && !body.sampleStorageKey.startsWith(`voice-samples/${workspace.id}/`)) {
      throw new Error("Voice sample key is not in this workspace namespace");
    }

    const status = nextConsentStatus(body.consent.verified);

    const created = await prisma.$transaction(async (tx) => {
      const consent = await tx.consentVerification.create({
        data: {
          workspaceId: workspace.id,
          subjectType: "VOICE_CLONE",
          subjectName: body.consent.subjectName,
          subjectEmail: body.consent.subjectEmail,
          status,
          reviewedByUserId: body.consent.verified ? user.id : null,
          verifiedAt: body.consent.verified ? new Date() : null,
          evidenceStorageKey: body.sampleStorageKey
        }
      });

      const voiceProfile = await tx.voiceProfile.create({
        data: {
          workspaceId: workspace.id,
          name: body.name,
          provider: body.provider,
          language: body.language
        }
      });

      const clone = await tx.voiceClone.create({
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
          summary: `Voice clone onboarding submitted for ${body.name}`,
          metadata: {
            voiceProfileId: voiceProfile.id,
            voiceCloneId: clone.id,
            consentVerificationId: consent.id,
            verified: body.consent.verified
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
            summary: `Voice clone verified for ${body.name}`,
            metadata: {
              voiceProfileId: voiceProfile.id,
              voiceCloneId: clone.id,
              consentVerificationId: consent.id
            }
          }
        });
      }

      return { consent, voiceProfile, clone };
    });

    return jsonOk(
      {
        voiceProfile: created.voiceProfile,
        voiceClone: created.clone,
        consent: created.consent
      },
      201
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
