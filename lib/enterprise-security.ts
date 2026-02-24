import { randomUUID } from "crypto";
import type { IdentityProviderConfig, WorkspaceSecurityPolicy } from "@prisma/client";
import { env } from "./env";
import { prisma } from "./prisma";
import { decryptSecret, redactSecret } from "./secret-box";

export const PUBLIC_API_DEFAULT_SCOPES = [
  "translate.read",
  "translate.submit",
  "translate.status",
  "translate.estimate"
] as const;

export type PublicApiScope = (typeof PUBLIC_API_DEFAULT_SCOPES)[number] | "translate.estimate" | "translate.all";

export function assertEnterpriseSecurityEnabled() {
  if (!env.ENABLE_ENTERPRISE_SECURITY) {
    throw new Error("Enterprise security features are disabled");
  }
}

export function assertSsoEnabled() {
  assertEnterpriseSecurityEnabled();
  if (!env.ENABLE_SSO) {
    throw new Error("SSO features are disabled");
  }
}

export function assertApiKeyScopesEnabled() {
  if (!env.ENABLE_API_KEY_SCOPES) {
    throw new Error("API key scopes are disabled");
  }
}

export function normalizePublicApiScopes(scopes: string[] | null | undefined): PublicApiScope[] {
  const input = scopes ?? [];
  const normalized = new Set<PublicApiScope>();
  for (const scope of input) {
    if (scope === "translate.read" || scope === "translate.submit" || scope === "translate.status" || scope === "translate.estimate" || scope === "translate.all") {
      normalized.add(scope);
    }
  }
  if (normalized.size === 0) {
    for (const scope of PUBLIC_API_DEFAULT_SCOPES) {
      normalized.add(scope);
    }
  }
  return [...normalized];
}

export function hasApiScope(scopes: string[] | null | undefined, required: PublicApiScope) {
  const normalized = normalizePublicApiScopes(scopes);
  if (normalized.includes("translate.all")) {
    return true;
  }
  return normalized.includes(required);
}

export async function ensureWorkspaceSecurityPolicy(workspaceId: string) {
  return prisma.workspaceSecurityPolicy.upsert({
    where: {
      workspaceId
    },
    update: {},
    create: {
      workspaceId,
      enforceSso: false,
      allowPasswordAuth: true,
      sessionTtlHours: 168,
      requireMfa: false
    }
  });
}

export function serializeIdentityProvider(provider: IdentityProviderConfig) {
  return {
    id: provider.id,
    workspaceId: provider.workspaceId,
    type: provider.type,
    name: provider.name,
    issuerUrl: provider.issuerUrl,
    clientId: provider.clientId,
    clientSecretMasked: redactSecret(provider.clientSecretCiphertext ? decryptSecret(provider.clientSecretCiphertext) : null),
    authorizationEndpoint: provider.authorizationEndpoint,
    tokenEndpoint: provider.tokenEndpoint,
    jwksUri: provider.jwksUri,
    samlEntityId: provider.samlEntityId,
    samlSsoUrl: provider.samlSsoUrl,
    enabled: provider.enabled,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt
  };
}

export function sanitizePolicy(policy: WorkspaceSecurityPolicy) {
  return {
    id: policy.id,
    workspaceId: policy.workspaceId,
    enforceSso: policy.enforceSso,
    allowPasswordAuth: policy.allowPasswordAuth,
    sessionTtlHours: policy.sessionTtlHours,
    requireMfa: policy.requireMfa,
    allowedEmailDomains: policy.allowedEmailDomains,
    canaryAllowlist: policy.canaryAllowlist,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt
  };
}

export function generateSsoState() {
  return randomUUID().replace(/-/g, "");
}

export function defaultSsoSessionExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000);
}

export function getProviderSecret(provider: Pick<IdentityProviderConfig, "clientSecretCiphertext">) {
  if (!provider.clientSecretCiphertext) {
    return null;
  }
  return decryptSecret(provider.clientSecretCiphertext);
}
