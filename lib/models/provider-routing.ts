import type { ProviderAdapter, ProviderCapability } from "@/lib/providers/types";
import { getPrimaryProvider, getProviderByName } from "@/lib/providers/registry";
import { prisma } from "@/lib/prisma";

export async function resolveProviderForCapability(capability: ProviderCapability): Promise<{
  provider: ProviderAdapter;
  policyId: string | null;
  modelVersionId: string | null;
  routeSource: "policy_active" | "policy_fallback" | "default";
}> {
  const policy = await prisma.routingPolicy.findUnique({
    where: { capability },
    include: {
      activeModelVersion: true,
      fallbackModelVersion: true
    }
  });

  if (!policy) {
    return {
      provider: getPrimaryProvider(capability),
      policyId: null,
      modelVersionId: null,
      routeSource: "default"
    };
  }

  const activeProviderName = policy.activeModelVersion?.provider;
  if (activeProviderName) {
    const activeProvider = getProviderByName(capability, activeProviderName);
    if (activeProvider) {
      return {
        provider: activeProvider,
        policyId: policy.id,
        modelVersionId: policy.activeModelVersionId,
        routeSource: "policy_active"
      };
    }
  }

  const fallbackProviderName = policy.fallbackModelVersion?.provider;
  if (fallbackProviderName) {
    const fallbackProvider = getProviderByName(capability, fallbackProviderName);
    if (fallbackProvider) {
      return {
        provider: fallbackProvider,
        policyId: policy.id,
        modelVersionId: policy.fallbackModelVersionId,
        routeSource: "policy_fallback"
      };
    }
  }

  return {
    provider: getPrimaryProvider(capability),
    policyId: policy.id,
    modelVersionId: null,
    routeSource: "default"
  };
}
