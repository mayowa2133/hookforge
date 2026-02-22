"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Plan = {
  tier: string;
  name: string;
  monthlyCredits: number;
  monthlyPriceCents: number;
  description: string;
};

type CreditPack = {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
};

type Member = {
  id: string;
  userId: string;
  email: string;
  role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
  createdAt: string;
};

type SharedProject = {
  id: string;
  title: string;
  status: string;
  template: {
    id: string;
    name: string;
    slug: string;
  };
  owner: {
    id: string;
    email: string;
  };
  updatedAt: string;
};

type UsageAlert = {
  id: string;
  severity: "INFO" | "WARN" | "HIGH";
  kind: string;
  title: string;
  detail: string;
};

type OverviewPayload = {
  workspaceId: string;
  balance: number;
  subscription: {
    id: string;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    plan: {
      id: string;
      tier: string;
      name: string;
      monthlyCredits: number;
    } | null;
  } | null;
  usage: {
    spent24h: number;
    spent7d: number;
    byFeature: Record<string, number>;
    alerts: UsageAlert[];
    anomalies: Array<{
      id: string;
      feature: string;
      severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
      summary: string;
      createdAt: string;
    }>;
  };
  plans: Plan[];
  creditPacks: CreditPack[];
};

type MobileConfigPayload = {
  platforms: Array<{
    id: string;
    status: string;
    installPath: string;
    notes: string;
  }>;
  quickLinks: Record<string, string>;
  captureCapabilities: Record<string, boolean>;
};

export function Phase6Launchpad() {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<SharedProject[]>([]);
  const [mobileConfig, setMobileConfig] = useState<MobileConfigPayload | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("EDITOR");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const currentTier = overview?.subscription?.plan?.tier ?? "NONE";

  const topFeatures = useMemo(() => {
    if (!overview) {
      return [] as Array<[string, number]>;
    }
    return Object.entries(overview.usage.byFeature)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [overview]);

  const refreshAll = async () => {
    const [overviewResp, membersResp, projectsResp, mobileResp] = await Promise.all([
      fetch("/api/billing/overview"),
      fetch("/api/workspace/members"),
      fetch("/api/workspace/projects"),
      fetch("/api/mobile/config")
    ]);

    const [overviewPayload, membersPayload, projectsPayload, mobilePayload] = await Promise.all([
      overviewResp.json(),
      membersResp.json(),
      projectsResp.json(),
      mobileResp.json()
    ]);

    if (!overviewResp.ok) {
      throw new Error(overviewPayload.error ?? "Failed to load billing overview");
    }
    if (!membersResp.ok) {
      throw new Error(membersPayload.error ?? "Failed to load workspace members");
    }
    if (!projectsResp.ok) {
      throw new Error(projectsPayload.error ?? "Failed to load workspace projects");
    }
    if (!mobileResp.ok) {
      throw new Error(mobilePayload.error ?? "Failed to load mobile config");
    }

    setOverview(overviewPayload as OverviewPayload);
    setMembers((membersPayload.members as Member[]) ?? []);
    setProjects((projectsPayload.projects as SharedProject[]) ?? []);
    setMobileConfig(mobilePayload as MobileConfigPayload);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await refreshAll();
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load Phase 6 launch data");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = async (tier: string) => {
    setBusyAction(`subscribe-${tier}`);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ tier })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Subscription update failed");
      }
      await refreshAll();
      setSuccess(`Subscription set to ${tier}.`);
    } catch (subscribeError) {
      setError(subscribeError instanceof Error ? subscribeError.message : "Subscription update failed");
    } finally {
      setBusyAction(null);
    }
  };

  const buyPack = async (packId: string) => {
    setBusyAction(`pack-${packId}`);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/billing/credit-packs/purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ packId })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Credit pack purchase failed");
      }
      await refreshAll();
      setSuccess(`${payload.pack?.name ?? "Credit pack"} purchased.`);
    } catch (packError) {
      setError(packError instanceof Error ? packError.message : "Credit pack purchase failed");
    } finally {
      setBusyAction(null);
    }
  };

  const reconcileBilling = async () => {
    setBusyAction("reconcile-billing");
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/billing/reconcile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          repairWalletMismatch: false
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Billing reconcile failed");
      }
      await refreshAll();
      setSuccess(`Billing reconciled. Open critical anomalies: ${payload.summary?.anomalies?.openCriticalCount ?? 0}.`);
    } catch (reconcileError) {
      setError(reconcileError instanceof Error ? reconcileError.message : "Billing reconcile failed");
    } finally {
      setBusyAction(null);
    }
  };

  const inviteMember = async () => {
    setBusyAction("invite");
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/workspace/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Member invite failed");
      }
      setInviteEmail("");
      await refreshAll();
      setSuccess(`${payload.member?.email ?? "Member"} added as ${payload.member?.role ?? inviteRole}.`);
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Member invite failed");
    } finally {
      setBusyAction(null);
    }
  };

  const updateMemberRole = async (memberId: string, role: string) => {
    setBusyAction(`role-${memberId}`);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/workspace/members/${memberId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ role })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Role update failed");
      }
      await refreshAll();
      setSuccess(`Member role updated to ${payload.member?.role ?? role}.`);
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "Role update failed");
    } finally {
      setBusyAction(null);
    }
  };

  const removeMember = async (memberId: string) => {
    setBusyAction(`remove-${memberId}`);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/workspace/members/${memberId}`, {
        method: "DELETE"
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Remove member failed");
      }
      await refreshAll();
      setSuccess(`Removed member ${payload.removedMemberId}.`);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Remove member failed");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-black" style={{ fontFamily: "var(--font-heading)" }}>
          Launch Console (Phase 7)
        </h1>
        <p className="text-sm text-muted-foreground">
          Mobile-ready operations, commercial guardrails, and shared workspace controls.
        </p>
      </div>

      {error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {success ? <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700">{success}</p> : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Workspace Billing</CardTitle>
            <CardDescription>Manage subscription tier, credit packs, and usage velocity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs uppercase text-muted-foreground">Current tier</p>
                <p className="font-semibold">{currentTier}</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs uppercase text-muted-foreground">Balance</p>
                <p className="font-semibold">{overview?.balance ?? 0} credits</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs uppercase text-muted-foreground">Spend</p>
                <p className="font-semibold">
                  24h {overview?.usage.spent24h ?? 0} / 7d {overview?.usage.spent7d ?? 0}
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {(overview?.plans ?? []).map((plan) => (
                <div key={plan.tier} className="rounded-md border p-3">
                  <p className="font-semibold">{plan.name}</p>
                  <p className="text-sm text-muted-foreground">{plan.monthlyCredits} credits / month</p>
                  <p className="text-sm text-muted-foreground">${(plan.monthlyPriceCents / 100).toFixed(2)} / month</p>
                  <Button
                    className="mt-3 w-full"
                    variant={plan.tier === currentTier ? "secondary" : "default"}
                    onClick={() => void subscribe(plan.tier)}
                    disabled={busyAction === `subscribe-${plan.tier}`}
                  >
                    {plan.tier === currentTier ? "Current Plan" : "Select Plan"}
                  </Button>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {(overview?.creditPacks ?? []).map((pack) => (
                <div key={pack.id} className="rounded-md border p-3">
                  <p className="font-semibold">{pack.name}</p>
                  <p className="text-sm text-muted-foreground">{pack.credits} credits</p>
                  <Button
                    className="mt-3 w-full"
                    variant="outline"
                    onClick={() => void buyPack(pack.id)}
                    disabled={busyAction === `pack-${pack.id}`}
                  >
                    Buy ${(pack.priceCents / 100).toFixed(2)}
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void reconcileBilling()} disabled={busyAction === "reconcile-billing"}>
                {busyAction === "reconcile-billing" ? "Reconciling..." : "Run Billing Reconcile"}
              </Button>
              <Link href="/api/workspace/audit" className="inline-flex h-10 items-center rounded-md border px-3 text-sm underline">
                Open Workspace Audit Trail
              </Link>
            </div>

            {overview?.usage.alerts.length ? (
              <div className="space-y-2">
                <p className="text-xs uppercase text-muted-foreground">Usage Alerts</p>
                {overview.usage.alerts.map((alert) => (
                  <div key={alert.id} className="rounded-md border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={alert.severity === "HIGH" ? "default" : "secondary"}>{alert.severity}</Badge>
                      <p className="font-medium">{alert.title}</p>
                    </div>
                    <p className="text-muted-foreground">{alert.detail}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {overview?.usage.anomalies.length ? (
              <div className="space-y-2">
                <p className="text-xs uppercase text-muted-foreground">Detected Anomalies</p>
                {overview.usage.anomalies.slice(0, 3).map((anomaly) => (
                  <div key={anomaly.id} className="rounded-md border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={anomaly.severity === "CRITICAL" || anomaly.severity === "HIGH" ? "default" : "secondary"}>
                        {anomaly.severity}
                      </Badge>
                      <p className="font-medium">{anomaly.feature}</p>
                    </div>
                    <p className="text-muted-foreground">{anomaly.summary}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {topFeatures.length ? (
              <div>
                <p className="text-xs uppercase text-muted-foreground">Top Credit Consumers</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {topFeatures.map(([feature, amount]) => (
                    <Badge key={feature} variant="secondary">
                      {feature}: {amount}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mobile Beta</CardTitle>
            <CardDescription>Web-install flow for iOS and Android while native wrappers mature.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(mobileConfig?.platforms ?? []).map((platform) => (
              <div key={platform.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-semibold uppercase">{platform.id}</p>
                  <Badge variant="secondary">{platform.status}</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{platform.notes}</p>
              </div>
            ))}
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-semibold">Quick Links</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(mobileConfig?.quickLinks ?? {}).map(([label, href]) => (
                  <Link key={label} href={href} className="underline">
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Workspace Members</CardTitle>
            <CardDescription>Add teammates and manage baseline roles.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <Label>Email</Label>
                <Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@example.com" />
              </div>
              <div className="space-y-1">
                <Label>Role</Label>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value)}
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="EDITOR">EDITOR</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
              </div>
            </div>
            <Button onClick={inviteMember} disabled={busyAction === "invite"}>
              {busyAction === "invite" ? "Adding..." : "Add Member"}
            </Button>

            <div className="space-y-2">
              {members.map((member) => (
                <div key={member.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{member.email}</p>
                      <p className="text-xs text-muted-foreground">Role: {member.role}</p>
                    </div>
                    {member.role === "OWNER" ? (
                      <Badge>OWNER</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void updateMemberRole(member.id, member.role === "ADMIN" ? "EDITOR" : "ADMIN")}
                          disabled={busyAction === `role-${member.id}`}
                        >
                          Toggle Admin
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void removeMember(member.id)}
                          disabled={busyAction === `remove-${member.id}`}
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shared Projects</CardTitle>
            <CardDescription>Latest workspace projects visible to members.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shared projects yet. Create one from the dashboard.</p>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{project.title}</p>
                    <Badge variant="secondary">{project.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {project.template.name} • Owner {project.owner.email}
                  </p>
                  <Link href={`/projects/${project.id}`} className="text-xs underline">
                    Open project
                  </Link>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
