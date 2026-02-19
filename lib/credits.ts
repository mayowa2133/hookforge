import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

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
  return prisma.creditWallet.upsert({
    where: { workspaceId },
    update: {},
    create: {
      workspaceId,
      balance: 0
    }
  });
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

  return addLedgerEntry({
    workspaceId: params.workspaceId,
    feature: params.feature,
    amount: -Math.abs(Math.trunc(params.amount)),
    entryType: "DEBIT",
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    metadata: params.metadata
  });
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
