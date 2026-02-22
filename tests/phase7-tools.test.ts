import { describe, expect, it } from "vitest";
import { buildCreditGuardrailDecision } from "@/lib/billing/guardrails";
import { classifyUsageAnomaly } from "@/lib/billing/anomalies";
import { summarizeLedgerIntegrity } from "@/lib/billing/reconciliation";
import { canAssignWorkspaceRole, canManageTargetRole } from "@/lib/workspace-roles";

describe("phase7 billing and collaboration hardening tools", () => {
  it("blocks preflight when single-job estimate exceeds guardrail", () => {
    const decision = buildCreditGuardrailDecision({
      feature: "dubbing.lipdub",
      estimatedCredits: 3200,
      availableCredits: 4000,
      monthlyCredits: 4000,
      spent24h: 200
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("SINGLE_JOB_LIMIT_EXCEEDED");
  });

  it("classifies anomalous spend spikes by severity", () => {
    const high = classifyUsageAnomaly({
      feature: "ai_creator.generate",
      actualAmount: 1400,
      expectedAmount: 300,
      deviationPct: 366.6
    });

    const none = classifyUsageAnomaly({
      feature: "ai_creator.generate",
      actualAmount: 220,
      expectedAmount: 200,
      deviationPct: 10
    });

    expect(high === "HIGH" || high === "CRITICAL").toBe(true);
    expect(none).toBeNull();
  });

  it("reports ledger reconciliation integrity correctly", () => {
    const healthy = summarizeLedgerIntegrity({
      walletBalance: 800,
      ledgerNetAmount: 800
    });
    const mismatch = summarizeLedgerIntegrity({
      walletBalance: 820,
      ledgerNetAmount: 800
    });

    expect(healthy.reconciliationRatePct).toBe(100);
    expect(mismatch.mismatch).toBe(20);
    expect(mismatch.reconciliationRatePct).toBe(0);
  });

  it("enforces stronger workspace role matrix rules", () => {
    expect(canAssignWorkspaceRole("OWNER", "ADMIN")).toBe(true);
    expect(canAssignWorkspaceRole("ADMIN", "ADMIN")).toBe(false);
    expect(canManageTargetRole("ADMIN", "EDITOR")).toBe(true);
    expect(canManageTargetRole("ADMIN", "ADMIN")).toBe(false);
  });
});
