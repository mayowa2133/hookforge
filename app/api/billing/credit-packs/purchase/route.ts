import { z } from "zod";
import { requireUserWithWorkspace } from "@/lib/api-context";
import { getCreditPackById } from "@/lib/billing/catalog";
import { addLedgerEntry, getCreditBalance } from "@/lib/credits";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { canManageWorkspaceMembers } from "@/lib/workspace-roles";

export const runtime = "nodejs";

const PurchaseSchema = z.object({
  packId: z.string().min(3).max(40)
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireUserWithWorkspace();
    const body = PurchaseSchema.parse(await request.json());

    const membership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: user.id
        }
      }
    });

    if (!membership || !canManageWorkspaceMembers(membership.role)) {
      return jsonError("Only admins can purchase credit packs", 403);
    }

    const pack = getCreditPackById(body.packId);
    if (!pack) {
      return jsonError("Unknown credit pack", 400);
    }

    const entry = await addLedgerEntry({
      workspaceId: workspace.id,
      feature: "credit-pack.purchase",
      amount: pack.credits,
      entryType: "CREDIT",
      referenceType: "CreditPack",
      referenceId: pack.id,
      metadata: {
        priceCents: pack.priceCents,
        purchasedByUserId: user.id
      }
    });

    const balance = await getCreditBalance(workspace.id);
    return jsonOk({
      status: "PURCHASED",
      pack,
      ledgerEntryId: entry.id,
      balance
    });
  } catch (error) {
    return routeErrorToResponse(error);
  }
}
