export type PlanTier = "STARTER" | "PRO" | "TEAM";

export type PlanCatalogItem = {
  tier: PlanTier;
  name: string;
  monthlyCredits: number;
  monthlyPriceCents: number;
  description: string;
};

export type CreditPack = {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
};

export const planCatalog: PlanCatalogItem[] = [
  {
    tier: "STARTER",
    name: "Starter",
    monthlyCredits: 1200,
    monthlyPriceCents: 2900,
    description: "Solo creators shipping short-form content weekly."
  },
  {
    tier: "PRO",
    name: "Pro",
    monthlyCredits: 4000,
    monthlyPriceCents: 7900,
    description: "High-volume creators with multilingual and AI workflows."
  },
  {
    tier: "TEAM",
    name: "Team",
    monthlyCredits: 10000,
    monthlyPriceCents: 17900,
    description: "Agencies and small teams managing shared projects."
  }
];

export const creditPacks: CreditPack[] = [
  {
    id: "pack_500",
    name: "500 Credits",
    credits: 500,
    priceCents: 1900
  },
  {
    id: "pack_2000",
    name: "2,000 Credits",
    credits: 2000,
    priceCents: 6900
  },
  {
    id: "pack_6000",
    name: "6,000 Credits",
    credits: 6000,
    priceCents: 17900
  }
];

export function getPlanByTier(tier: string) {
  const normalized = tier.trim().toUpperCase();
  return planCatalog.find((plan) => plan.tier === normalized);
}

export function getCreditPackById(packId: string) {
  return creditPacks.find((pack) => pack.id === packId.trim());
}
