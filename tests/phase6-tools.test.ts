import { describe, expect, it } from "vitest";
import { getCreditPackById, getPlanByTier, planCatalog } from "@/lib/billing/catalog";
import { buildUsageAlerts } from "@/lib/billing/usage-alerts";
import { canManageWorkspaceMembers, isAtLeastRole } from "@/lib/workspace-roles";

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
});
