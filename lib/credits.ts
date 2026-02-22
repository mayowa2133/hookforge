import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";
import { evaluateWorkspaceCreditGuardrails } from "./billing/guardrails";
import { scanUsageAnomaliesForWorkspace } from "./billing/anomalies";

type LedgerParams = {
  workspaceId: string;
  amount: number;
  entryType: "CREDIT" | "DEBIT" | "ADJUSTMENT" | "REFUND";
  feature: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
};

export async function ensureCreditWallet(workspaceId: string) {
  const wallet = await prisma.creditWallet.upsert({
    where: { workspaceId },
    update: {},
    create: {
      workspaceId,
      balance: 0
    }
  });

  if (wallet.balance > 0) {
    const [existingBootstrap, existingAnyEntry] = await Promise.all([
      prisma.creditLedgerEntry.findFirst({
        where: {
          workspaceId,
          feature: "wallet.bootstrap",
          referenceType: "Workspace",
          referenceId: workspaceId
        },
        select: { id: true }
      }),
      prisma.creditLedgerEntry.findFirst({
        where: {
          workspaceId
        },
        select: { id: true }
      })
    ]);

    if (!existingBootstrap && !existingAnyEntry) {
      await prisma.creditLedgerEntry.create({
        data: {
          walletId: wallet.id,
          workspaceId,
          feature: "wallet.bootstrap",
          entryType: "CREDIT",
          amount: wallet.balance,
          referenceType: "Workspace",
          referenceId: workspaceId,
          metadata: {
            source: "seeded-wallet-balance"
          } as Prisma.InputJsonValue
        }
      });
    }
  }

  return wallet;
}

export async function addLedgerEntry(params: LedgerParams) {
  const wallet = await ensureCreditWallet(params.workspaceId);
  const amount = Math.trunc(params.amount);

  return prisma.$transaction(async (tx) => {
    const current = await tx.creditWallet.findUnique({ where: { workspaceId: params.workspaceId } });
    if (!current) {
      throw new Error("Credit wallet not found");
    }

    const nextBalance = current.balance + amount;
    if (nextBalance < 0) {
      throw new Error("Insufficient credits");
    }

    await tx.creditWallet.update({
      where: { id: wallet.id },
      data: { balance: nextBalance }
    });

    return tx.creditLedgerEntry.create({
      data: {
        walletId: wallet.id,
        workspaceId: params.workspaceId,
        feature: params.feature,
        entryType: params.entryType,
        amount,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        metadata: params.metadata as Prisma.InputJsonValue | undefined
      }
    });
  });
}

export async function reserveCredits(params: {
  workspaceId: string;
  feature: string;
  amount: number;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}) {
  if (params.amount <= 0) {
    return null;
  }

  const absoluteAmount = Math.abs(Math.trunc(params.amount));
  const guardrail = await evaluateWorkspaceCreditGuardrails({
    workspaceId: params.workspaceId,
    feature: params.feature,
    estimatedCredits: absoluteAmount
  });

  if (!guardrail.allowed) {
    throw new Error(`Credit guardrail blocked: ${guardrail.reasonCode}`);
  }

  const entry = await addLedgerEntry({
    workspaceId: params.workspaceId,
    feature: params.feature,
    amount: -absoluteAmount,
    entryType: "DEBIT",
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    metadata: {
      ...(params.metadata ?? {}),
      guardrail: {
        reasonCode: guardrail.reasonCode,
        warnings: guardrail.warnings,
        postDebitBalance: guardrail.postDebitBalance
      }
    }
  });

  // Non-blocking anomaly scan to keep usage alerts and quality metrics current.
  scanUsageAnomaliesForWorkspace({
    workspaceId: params.workspaceId,
    featureFilter: params.feature
  }).catch(() => undefined);

  return entry;
}

export async function getCreditBalance(workspaceId: string) {
  const wallet = await ensureCreditWallet(workspaceId);
  return wallet.balance;
}

export async function listLedgerEntries(workspaceId: string, take = 50) {
  return prisma.creditLedgerEntry.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(200, take))
  });
}
