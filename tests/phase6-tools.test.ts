import { describe, expect, it } from "vitest";
import { getCreditPackById, getPlanByTier, planCatalog } from "@/lib/billing/catalog";
import { buildUsageAlerts } from "@/lib/billing/usage-alerts";
import { canManageWorkspaceMembers, isAtLeastRole } from "@/lib/workspace-roles";
import { mobileWorkflowCatalog, summarizeMobileTelemetry } from "@/lib/mobile/telemetry";

describe("phase6 commercialization and collaboration tools", () => {
  it("resolves plan and credit pack catalog entries", () => {
    expect(planCatalog.length).toBeGreaterThanOrEqual(3);
    expect(getPlanByTier("pro")?.monthlyCredits).toBeGreaterThan(1000);
    expect(getCreditPackById("pack_500")?.credits).toBe(500);
  });

  it("builds usage alerts from balance and spend velocity", () => {
    const usage = buildUsageAlerts({
      balance: 120,
      monthlyCredits: 1000,
      recentEntries: [
        {
          amount: -260,
          feature: "ai-creator.generate",
          createdAt: new Date(Date.now() - 60 * 60 * 1000)
        },
        {
          amount: -180,
          feature: "public-api.translate",
          createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000)
        }
      ]
    });

    expect(usage.metrics.spent24h).toBe(440);
    expect(usage.alerts.some((alert) => alert.kind === "LOW_CREDITS")).toBe(true);
    expect(usage.alerts.some((alert) => alert.kind === "HIGH_BURN")).toBe(true);
  });

  it("enforces workspace role hierarchy", () => {
    expect(isAtLeastRole("OWNER", "ADMIN")).toBe(true);
    expect(isAtLeastRole("EDITOR", "ADMIN")).toBe(false);
    expect(canManageWorkspaceMembers("ADMIN")).toBe(true);
    expect(canManageWorkspaceMembers("VIEWER")).toBe(false);
  });

  it("calculates mobile parity summary targets", () => {
    const summary = summarizeMobileTelemetry({
      global: {
        sessionsStarted: 120,
        sessionsEnded: 115,
        sessionsCrashed: 0,
        workflowStartedTotal: 60,
        workflowCompletedTotal: 56,
        uploadResumes: 10,
        uploadFailures: 2,
        exportsStarted: 40,
        exportsCompleted: 38,
        latencySumMs: 120_000,
        latencyCount: 80
      },
      workflows: {
        creator_to_render: {
          started: 20,
          completed: 18,
          latencySumMs: 36_000,
          latencyCount: 20
        },
        template_edit_render: {
          started: 24,
          completed: 22,
          latencySumMs: 30_000,
          latencyCount: 24
        },
        localization_dub: {
          started: 16,
          completed: 16,
          latencySumMs: 54_000,
          latencyCount: 36
        }
      }
    });

    expect(mobileWorkflowCatalog.length).toBeGreaterThanOrEqual(3);
    expect(summary.crashFreeSessionsPct).toBe(100);
    expect(summary.meetsCrashFreeTarget).toBe(true);
    expect(summary.topWorkflowGapPct).toBeLessThanOrEqual(10);
    expect(summary.meetsWorkflowGapTarget).toBe(true);
  });
});
