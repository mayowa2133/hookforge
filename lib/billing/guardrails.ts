import { creditPacks } from "@/lib/billing/catalog";
import { prisma } from "@/lib/prisma";

export type CreditGuardrailDecision = {
  allowed: boolean;
  reasonCode:
    | "OK"
    | "INSUFFICIENT_CREDITS"
    | "SINGLE_JOB_LIMIT_EXCEEDED"
    | "INVALID_ESTIMATE";
  severity: "INFO" | "WARN" | "HIGH" | "BLOCK";
  estimatedCredits: number;
  availableCredits: number;
  monthlyCredits: number | null;
  singleJobCreditLimit: number;
  postDebitBalance: number;
  warnings: string[];
  recommendedPack: {
    id: string;
    name: string;
    credits: number;
    priceCents: number;
  } | null;
};

function pickRecommendedPack(requiredCredits: number) {
  if (requiredCredits <= 0) {
    return null;
  }
  const sorted = [...creditPacks].sort((a, b) => a.credits - b.credits);
  return sorted.find((pack) => pack.credits >= requiredCredits) ?? sorted[sorted.length - 1] ?? null;
}

function singleJobLimit(monthlyCredits: number | null) {
  if (!monthlyCredits || monthlyCredits <= 0) {
    return 1500;
  }
  return Math.max(900, Math.floor(monthlyCredits * 0.75));
}

export function buildCreditGuardrailDecision(params: {
  estimatedCredits: number;
  availableCredits: number;
  monthlyCredits: number | null;
  spent24h: number;
  feature: string;
}): CreditGuardrailDecision {
  const estimatedCredits = Math.max(0, Math.trunc(params.estimatedCredits));
  const availableCredits = Math.trunc(params.availableCredits);
  const monthlyCredits = params.monthlyCredits ?? null;
  const spent24h = Math.max(0, Math.trunc(params.spent24h));
  const jobLimit = singleJobLimit(monthlyCredits);
  const postDebitBalance = availableCredits - estimatedCredits;
  const warnings: string[] = [];

  if (estimatedCredits <= 0) {
    return {
      allowed: false,
      reasonCode: "INVALID_ESTIMATE",
      severity: "BLOCK",
      estimatedCredits,
      availableCredits,
      monthlyCredits,
      singleJobCreditLimit: jobLimit,
      postDebitBalance,
      warnings: [`Feature ${params.feature} produced an invalid credit estimate.`],
      recommendedPack: null
    };
  }

  if (estimatedCredits > jobLimit) {
    const required = Math.max(0, estimatedCredits - availableCredits);
    return {
      allowed: false,
      reasonCode: "SINGLE_JOB_LIMIT_EXCEEDED",
      severity: "BLOCK",
      estimatedCredits,
      availableCredits,
      monthlyCredits,
      singleJobCreditLimit: jobLimit,
      postDebitBalance,
      warnings: [
        `Estimated cost ${estimatedCredits} exceeds single-job limit ${jobLimit}. Split workflow into smaller batches.`
      ],
      recommendedPack: pickRecommendedPack(required)
    };
  }

  if (postDebitBalance < 0) {
    const required = Math.abs(postDebitBalance);
    return {
      allowed: false,
      reasonCode: "INSUFFICIENT_CREDITS",
      severity: "BLOCK",
      estimatedCredits,
      availableCredits,
      monthlyCredits,
      singleJobCreditLimit: jobLimit,
      postDebitBalance,
      warnings: [`Need ${required} more credits to run this workflow.`],
      recommendedPack: pickRecommendedPack(required)
    };
  }

  const lowThreshold = monthlyCredits ? Math.max(150, Math.floor(monthlyCredits * 0.15)) : 200;
  if (postDebitBalance <= lowThreshold) {
    warnings.push(`Post-run balance (${postDebitBalance}) will be near the low-credit threshold (${lowThreshold}).`);
  }

  if (monthlyCredits) {
    const highBurnThreshold = Math.floor(monthlyCredits * 0.6);
    if (spent24h + estimatedCredits >= highBurnThreshold) {
      warnings.push(`24h burn would reach ${spent24h + estimatedCredits} credits (high-burn threshold ${highBurnThreshold}).`);
    }
  }

  return {
    allowed: true,
    reasonCode: "OK",
    severity: warnings.length > 0 ? "WARN" : "INFO",
    estimatedCredits,
    availableCredits,
    monthlyCredits,
    singleJobCreditLimit: jobLimit,
    postDebitBalance,
    warnings,
    recommendedPack: null
  };
}

export async function evaluateWorkspaceCreditGuardrails(params: {
  workspaceId: string;
  feature: string;
  estimatedCredits: number;
}) {
  const [wallet, activePlan, entries] = await Promise.all([
    prisma.creditWallet.findUnique({
      where: { workspaceId: params.workspaceId },
      select: { balance: true }
    }),
    prisma.subscription.findFirst({
      where: {
        workspaceId: params.workspaceId,
        status: "ACTIVE"
      },
      include: { plan: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.creditLedgerEntry.findMany({
      where: {
        workspaceId: params.workspaceId,
        amount: { lt: 0 },
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      },
      select: {
        amount: true
      }
    })
  ]);

  const availableCredits = wallet?.balance ?? 0;
  const spent24h = entries.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

  return buildCreditGuardrailDecision({
    estimatedCredits: params.estimatedCredits,
    availableCredits,
    monthlyCredits: activePlan?.plan?.monthlyCredits ?? null,
    spent24h,
    feature: params.feature
  });
}
