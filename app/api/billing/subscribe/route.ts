import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { getPlanByTier } from "@/lib/billing/catalog";
import { reconcileWorkspaceBillingState } from "@/lib/billing/reconciliation";
import { addLedgerEntry, getCreditBalance } from "@/lib/credits";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const SubscribeSchema = z.object({
  tier: z.string().min(2).max(24)
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "billing.manage",
      request
    });
    const body = SubscribeSchema.parse(await request.json());

    const requestedPlan = getPlanByTier(body.tier);
    if (!requestedPlan) {
      return jsonError("Unknown plan tier", 400);
    }

    await reconcileWorkspaceBillingState({
      workspaceId: workspace.id,
      actorUserId: user.id,
      repairWalletMismatch: false
    });

    const existingActive = await prisma.subscription.findFirst({
      where: {
        workspaceId: workspace.id,
        status: "ACTIVE"
      },
      include: {
        plan: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (existingActive?.plan?.tier.toUpperCase() === requestedPlan.tier) {
      const balance = await getCreditBalance(workspace.id);
      return jsonOk({
        status: "UNCHANGED",
        balance,
        subscription: {
          id: existingActive.id,
          status: existingActive.status,
          currentPeriodStart: existingActive.currentPeriodStart,
          currentPeriodEnd: existingActive.currentPeriodEnd
        },
        plan: requestedPlan
      });
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const next = await prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: {
          workspaceId: workspace.id,
          status: {
            in: ["ACTIVE", "TRIALING"]
          }
        },
        data: {
          status: "CANCELED",
          currentPeriodEnd: now
        }
      });

      await tx.plan.updateMany({
        where: {
          workspaceId: workspace.id,
          status: "ACTIVE"
        },
        data: {
          status: "PAUSED"
        }
      });

      const planRecord = await tx.plan.create({
        data: {
          workspaceId: workspace.id,
          name: requestedPlan.name,
          tier: requestedPlan.tier,
          monthlyCredits: requestedPlan.monthlyCredits,
          status: "ACTIVE"
        }
      });

      const subscription = await tx.subscription.create({
        data: {
          workspaceId: workspace.id,
          planId: planRecord.id,
          provider: "hookforge-local",
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          externalReference: `local_${workspace.id}_${requestedPlan.tier}_${now.getTime()}`
        }
      });

      return { planRecord, subscription };
    });

    await addLedgerEntry({
      workspaceId: workspace.id,
      feature: "subscription.monthly_allocation",
      amount: requestedPlan.monthlyCredits,
      entryType: "CREDIT",
      referenceType: "Subscription",
      referenceId: next.subscription.id,
      metadata: {
        tier: requestedPlan.tier,
        source: "phase6-subscribe"
      }
    });

    const balance = await getCreditBalance(workspace.id);

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "subscription_change",
      targetType: "Subscription",
      targetId: next.subscription.id,
      details: {
        tier: requestedPlan.tier,
        status: "ACTIVE"
      }
    });

    return jsonOk({
      status: "SUBSCRIBED",
      balance,
      plan: requestedPlan,
      subscription: {
        id: next.subscription.id,
        status: next.subscription.status,
        currentPeriodStart: next.subscription.currentPeriodStart,
        currentPeriodEnd: next.subscription.currentPeriodEnd
      }
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
