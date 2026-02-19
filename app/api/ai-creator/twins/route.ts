import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { demoActorPresets, nextConsentStatus } from "@/lib/ai/phase3";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const TwinSchema = z.object({
  name: z.string().min(2).max(80),
  actorId: z.string().min(1).optional(),
  voiceProfileId: z.string().min(1).optional(),
  consent: z.object({
    subjectName: z.string().min(2).max(120),
    subjectEmail: z.string().email().optional(),
    verified: z.boolean()
  })
});

export async function GET() {
  try {
    const { workspace } = await requireUserWithWorkspace();

    const twins = await prisma.aITwin.findMany({
      where: {
        workspaceId: workspace.id
      },
      include: {
        voiceProfile: true,
        avatarProfile: true,
        consentVerification: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    return jsonOk({
      twins,
      actors: demoActorPresets
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const body = TwinSchema.parse(await request.json());

    const actorId = body.actorId ?? demoActorPresets[0].id;
    const actorPreset = demoActorPresets.find((preset) => preset.id === actorId);
    if (!actorPreset) {
      throw new Error("Actor preset not found");
    }

    if (body.voiceProfileId) {
      const voiceProfile = await prisma.voiceProfile.findFirst({
        where: {
          id: body.voiceProfileId,
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
        throw new Error("Voice profile clone consent must be VERIFIED for AI twin assignment");
      }
    }

    const status = nextConsentStatus(body.consent.verified);

    const created = await prisma.$transaction(async (tx) => {
      const consent = await tx.consentVerification.create({
        data: {
          workspaceId: workspace.id,
          subjectType: "AI_TWIN",
          subjectName: body.consent.subjectName,
          subjectEmail: body.consent.subjectEmail,
          status,
          reviewedByUserId: body.consent.verified ? user.id : null,
          verifiedAt: body.consent.verified ? new Date() : null
        }
      });

      const avatar = await tx.avatarProfile.create({
        data: {
          workspaceId: workspace.id,
          name: `${body.name} Avatar`,
          provider: "hookforge-demo-actor",
          providerAvatarId: actorPreset.id,
          previewStorageKey: `demo-assets/${actorPreset.backgroundFile}`,
          consentVerificationId: consent.id
        }
      });

      const twin = await tx.aITwin.create({
        data: {
          workspaceId: workspace.id,
          name: body.name,
          avatarProfileId: avatar.id,
          voiceProfileId: body.voiceProfileId,
          consentVerificationId: consent.id,
          status
        },
        include: {
          voiceProfile: true,
          avatarProfile: true,
          consentVerification: true
        }
      });

      await tx.trustEvent.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          eventType: "CONSENT_SUBMITTED",
          severity: body.consent.verified ? "INFO" : "WARN",
          summary: `AI twin onboarding submitted for ${body.name}`,
          metadata: {
            aiTwinId: twin.id,
            avatarProfileId: avatar.id,
            consentVerificationId: consent.id,
            actorId: actorPreset.id
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
            summary: `AI twin verified for ${body.name}`,
            metadata: {
              aiTwinId: twin.id,
              consentVerificationId: consent.id
            }
          }
        });
      }

      return { twin, avatar, consent };
    });

    return jsonOk(
      {
        twin: created.twin,
        avatar: created.avatar,
        consent: created.consent
      },
      201
    );
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
