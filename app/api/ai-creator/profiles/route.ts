import { requireUserWithWorkspace } from "@/lib/api-context";
import { routeErrorToResponse, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { workspace } = await requireUserWithWorkspace();

    const [voiceProfiles, twins, consentVerifications] = await Promise.all([
      prisma.voiceProfile.findMany({
        where: {
          workspaceId: workspace.id
        },
        include: {
          voiceClones: {
            include: {
              consentVerification: true
            },
            orderBy: {
              createdAt: "desc"
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      }),
      prisma.aITwin.findMany({
        where: {
          workspaceId: workspace.id
        },
        include: {
          voiceProfile: {
            select: {
              id: true,
              name: true,
              language: true
            }
          },
          avatarProfile: {
            select: {
              id: true,
              name: true,
              providerAvatarId: true,
              previewStorageKey: true
            }
          },
          consentVerification: true
        },
        orderBy: {
          createdAt: "desc"
        }
      }),
      prisma.consentVerification.findMany({
        where: {
          workspaceId: workspace.id
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 30
      })
    ]);

    return jsonOk({
      voiceProfiles,
      twins,
      consentVerifications
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
