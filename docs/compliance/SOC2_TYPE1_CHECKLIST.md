# HookForge SOC 2 Type I Readiness Checklist

Last updated: 2026-02-24

## Security controls
- Identity and access management:
  - Workspace-bound OIDC/SAML configuration APIs.
  - SSO enforcement policy (`enforceSso`, `allowPasswordAuth`) with password-block behavior.
  - Capability-based route guard (`requireWorkspaceCapability`) for protected APIs.
- Authentication hardening:
  - Session TTL support in signed session token and cookie helpers.
  - SSO session trace records (`SsoSession`) for OIDC and SAML flows.
- API security:
  - Public API key scopes, rotation, disable lifecycle, and per-key rate limiting.
  - Scope checks enforced on public translate endpoints.

## Logging and monitoring controls
- Immutable audit trail:
  - Append-only `AuditEvent` model and writer utility.
  - Audit emission on policy changes, member updates, billing controls, SSO flows, API key lifecycle operations, and ops backup verification.
- Operational visibility:
  - `/api/ops/slo/summary`
  - `/api/ops/queues/health`
  - `/api/ops/recovery/backup-verify`
  - `SystemIncident` records for recovery verification outcomes.

## Change management controls
- Additive Prisma migrations with no destructive changes for enterprise hardening tables.
- Feature flags:
  - `ENABLE_ENTERPRISE_SECURITY`
  - `ENABLE_SSO`
  - `ENABLE_API_KEY_SCOPES`

## Evidence map
- Schema and migrations:
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/prisma/schema.prisma`
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/prisma/migrations/20260224030000_enterprise_hardening/migration.sql`
- Auth and policy enforcement:
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/app/api/auth/login/route.ts`
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/app/api/workspace/security/policy/route.ts`
- SSO core:
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/app/api/auth/sso/oidc/start/route.ts`
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/app/api/auth/sso/oidc/callback/route.ts`
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/app/api/auth/sso/saml/acs/route.ts`
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/app/api/auth/sso/saml/metadata/route.ts`
- Audit + API keys + ops:
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/lib/workspace-audit.ts`
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/app/api/public-api-keys/route.ts`
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/app/api/ops/slo/summary/route.ts`
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/app/api/ops/queues/health/route.ts`
  - `/Users/mayowaadesanya/Documents/Projects/hookforge/app/api/ops/recovery/backup-verify/route.ts`

