"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SecurityPolicy = {
  enforceSso: boolean;
  allowPasswordAuth: boolean;
  sessionTtlHours: number;
  requireMfa: boolean;
};

type Provider = {
  id: string;
  type: "OIDC" | "SAML";
  name: string;
  issuerUrl: string | null;
  clientId: string | null;
  clientSecretMasked: string | null;
  enabled: boolean;
  createdAt: string;
};

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  scopes: string[];
  rateLimitPerMinute: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastRotationAt: string | null;
  createdAt: string;
};

type AuditEvent = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  actor?: {
    id: string;
    email: string;
  } | null;
};

function idempotencyHeaders() {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID()
  };
}

export function EnterpriseSecurityCenter() {
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [opsSummary, setOpsSummary] = useState<Record<string, unknown> | null>(null);
  const [queueHealth, setQueueHealth] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [providerName, setProviderName] = useState("Enterprise OIDC");
  const [providerIssuerUrl, setProviderIssuerUrl] = useState("https://example-idp.local");
  const [providerClientId, setProviderClientId] = useState("hookforge-client");
  const [providerClientSecret, setProviderClientSecret] = useState("change-me");

  const [selectedApiKeyId, setSelectedApiKeyId] = useState("");
  const [scopeInput, setScopeInput] = useState("translate.read,translate.submit,translate.status,translate.estimate");

  const selectedApiKey = useMemo(
    () => apiKeys.find((key) => key.id === selectedApiKeyId) ?? null,
    [apiKeys, selectedApiKeyId]
  );

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [policyResp, providersResp, apiKeysResp, auditResp, opsResp, queueResp] = await Promise.all([
        fetch("/api/workspace/security/policy", { cache: "no-store" }),
        fetch("/api/workspace/security/sso/providers", { cache: "no-store" }),
        fetch("/api/public-api-keys", { cache: "no-store" }),
        fetch("/api/workspace/audit/events?take=40", { cache: "no-store" }),
        fetch("/api/ops/slo/summary?windowHours=24", { cache: "no-store" }),
        fetch("/api/ops/queues/health", { cache: "no-store" })
      ]);

      const policyJson = await policyResp.json();
      const providerJson = await providersResp.json();
      const keyJson = await apiKeysResp.json();
      const auditJson = await auditResp.json();
      const opsJson = await opsResp.json();
      const queueJson = await queueResp.json();

      if (!policyResp.ok) {
        throw new Error(policyJson.error ?? "Failed to load security policy");
      }

      setPolicy(policyJson.policy as SecurityPolicy);
      setProviders((providerJson.providers ?? []) as Provider[]);
      const keys = (keyJson.apiKeys ?? []) as ApiKey[];
      setApiKeys(keys);
      if (!selectedApiKeyId && keys[0]) {
        setSelectedApiKeyId(keys[0].id);
        setScopeInput(keys[0].scopes.join(","));
      }
      setAuditEvents((auditJson.events ?? []) as AuditEvent[]);
      setOpsSummary((opsJson.summary ?? null) as Record<string, unknown> | null);
      setQueueHealth(queueJson as Record<string, unknown>);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load enterprise security data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const onSavePolicy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!policy) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/security/policy", {
        method: "POST",
        headers: idempotencyHeaders(),
        body: JSON.stringify(policy)
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Policy update failed");
      }
      setPolicy(payload.policy as SecurityPolicy);
      await loadAll();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Policy update failed");
    } finally {
      setLoading(false);
    }
  };

  const onCreateProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/security/sso/providers", {
        method: "POST",
        headers: idempotencyHeaders(),
        body: JSON.stringify({
          type: "OIDC",
          name: providerName,
          issuerUrl: providerIssuerUrl,
          clientId: providerClientId,
          clientSecret: providerClientSecret,
          enabled: true
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Provider creation failed");
      }
      await loadAll();
    } catch (providerError) {
      setError(providerError instanceof Error ? providerError.message : "Provider creation failed");
    } finally {
      setLoading(false);
    }
  };

  const onUpdateScopes = async () => {
    if (!selectedApiKey) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/public-api-keys/${selectedApiKey.id}/scopes`, {
        method: "POST",
        headers: idempotencyHeaders(),
        body: JSON.stringify({
          scopes: scopeInput
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean)
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Scope update failed");
      }
      await loadAll();
    } catch (scopeError) {
      setError(scopeError instanceof Error ? scopeError.message : "Scope update failed");
    } finally {
      setLoading(false);
    }
  };

  const onRotateKey = async () => {
    if (!selectedApiKey) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/public-api-keys/${selectedApiKey.id}/rotate`, {
        method: "POST",
        headers: idempotencyHeaders(),
        body: JSON.stringify({
          overlapMinutes: 15
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Key rotation failed");
      }
      await loadAll();
    } catch (rotateError) {
      setError(rotateError instanceof Error ? rotateError.message : "Key rotation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Enterprise Security Center</CardTitle>
          <CardDescription>SSO, workspace policies, API key controls, audit history, and ops health.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary">{loading ? "Refreshing" : "Loaded"}</Badge>
          <Badge variant="outline">Providers: {providers.length}</Badge>
          <Badge variant="outline">API keys: {apiKeys.length}</Badge>
          <Badge variant="outline">Audit events: {auditEvents.length}</Badge>
          <Button size="sm" variant="outline" onClick={() => void loadAll()} disabled={loading}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspace Policy</CardTitle>
            <CardDescription>Enforce SSO, control password fallback, and session TTL.</CardDescription>
          </CardHeader>
          <CardContent>
            {policy ? (
              <form className="space-y-3" onSubmit={onSavePolicy}>
                <Label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={policy.enforceSso}
                    onChange={(event) => setPolicy({ ...policy, enforceSso: event.target.checked })}
                  />
                  Enforce SSO-only login
                </Label>
                <Label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={policy.allowPasswordAuth}
                    onChange={(event) => setPolicy({ ...policy, allowPasswordAuth: event.target.checked })}
                  />
                  Allow password fallback
                </Label>
                <Label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={policy.requireMfa}
                    onChange={(event) => setPolicy({ ...policy, requireMfa: event.target.checked })}
                  />
                  Require MFA (scaffold)
                </Label>
                <div className="space-y-1">
                  <Label>Session TTL (hours)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={720}
                    value={policy.sessionTtlHours}
                    onChange={(event) => setPolicy({ ...policy, sessionTtlHours: Number(event.target.value) })}
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  Save Policy
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">Policy unavailable.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SSO Providers</CardTitle>
            <CardDescription>Create and inspect workspace-bound OIDC providers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form className="space-y-2" onSubmit={onCreateProvider}>
              <Input value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="Provider name" />
              <Input value={providerIssuerUrl} onChange={(event) => setProviderIssuerUrl(event.target.value)} placeholder="Issuer URL" />
              <Input value={providerClientId} onChange={(event) => setProviderClientId(event.target.value)} placeholder="Client ID" />
              <Input
                value={providerClientSecret}
                onChange={(event) => setProviderClientSecret(event.target.value)}
                placeholder="Client secret"
              />
              <Button type="submit" disabled={loading}>
                Add OIDC Provider
              </Button>
            </form>

            <div className="max-h-48 space-y-2 overflow-y-auto rounded border p-2 text-xs">
              {providers.length ? (
                providers.map((provider) => (
                  <div key={provider.id} className="rounded border p-2">
                    <p className="font-semibold">
                      {provider.name} <span className="text-muted-foreground">({provider.type})</span>
                    </p>
                    <p className="text-muted-foreground">
                      Enabled: {String(provider.enabled)} • Secret: {provider.clientSecretMasked ?? "n/a"}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">No providers configured.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>API Key Scopes</CardTitle>
            <CardDescription>Rotate keys and lock access to explicit public API scopes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Selected key</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={selectedApiKeyId}
                onChange={(event) => {
                  const id = event.target.value;
                  setSelectedApiKeyId(id);
                  const key = apiKeys.find((entry) => entry.id === id);
                  setScopeInput(key ? key.scopes.join(",") : "");
                }}
              >
                <option value="">Select API key</option>
                {apiKeys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.name} ({key.status})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Scopes (comma-separated)</Label>
              <Input value={scopeInput} onChange={(event) => setScopeInput(event.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void onUpdateScopes()} disabled={loading || !selectedApiKey}>
                Update Scopes
              </Button>
              <Button variant="outline" onClick={() => void onRotateKey()} disabled={loading || !selectedApiKey}>
                Rotate Key
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audit Events</CardTitle>
            <CardDescription>Immutable security/compliance activity stream.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-64 space-y-2 overflow-y-auto rounded border p-2 text-xs">
              {auditEvents.length ? (
                auditEvents.map((event) => (
                  <div key={event.id} className="rounded border p-2">
                    <p className="font-semibold">{event.action}</p>
                    <p className="text-muted-foreground">
                      {event.targetType}
                      {event.targetId ? `/${event.targetId.slice(0, 8)}` : ""} •{" "}
                      {new Date(event.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">No audit events yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>SLO Summary</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <pre className="overflow-x-auto rounded border p-2">{JSON.stringify(opsSummary, null, 2)}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Queue Health</CardTitle>
          </CardHeader>
          <CardContent className="text-xs">
            <pre className="overflow-x-auto rounded border p-2">{JSON.stringify(queueHealth, null, 2)}</pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
