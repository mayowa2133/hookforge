import { z } from "zod";
import { requireWorkspaceCapability } from "@/lib/api-context";
import { getCreditPackById } from "@/lib/billing/catalog";
import { addLedgerEntry, getCreditBalance } from "@/lib/credits";
import { routeErrorToResponse, jsonError, jsonOk } from "@/lib/http";
import { recordWorkspaceAuditEvent } from "@/lib/workspace-audit";

export const runtime = "nodejs";

const PurchaseSchema = z.object({
  packId: z.string().min(3).max(40)
});

export async function POST(request: Request) {
  try {
    const { user, workspace } = await requireWorkspaceCapability({
      capability: "billing.manage",
      request
    });
    const body = PurchaseSchema.parse(await request.json());

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

    await recordWorkspaceAuditEvent({
      workspaceId: workspace.id,
      actorUserId: user.id,
      action: "credit_pack_purchase",
      targetType: "CreditPack",
      targetId: pack.id,
      details: {
        credits: pack.credits,
        priceCents: pack.priceCents
      }
    });

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
