# Enterprise Recovery Runbook (Single Region)

Last updated: 2026-02-24

## Purpose
Operational checklist for enterprise hardening recovery drills in a single-region deployment.

## Preconditions
- Docker services running (`postgres`, `redis`, `minio`).
- Workspace admin account available.
- App and worker running.

## Recovery verification procedure
1. Query queue health:
   - `GET /api/ops/queues/health`
2. Query SLO summary:
   - `GET /api/ops/slo/summary?windowHours=24`
3. Run backup verification endpoint:
   - `POST /api/ops/recovery/backup-verify`
   - include `Idempotency-Key` header.
4. Confirm:
   - `passed=true` in response.
   - a `SystemIncident` record exists with `status=RESOLVED`.
   - corresponding `AuditEvent` exists with `action=ops_backup_verify`.

## Failure handling
1. If any check returns `FAIL`, open incident in `SystemIncident` with severity `HIGH`.
2. Capture failing check metadata and attach to incident.
3. Temporarily disable enterprise rollouts:
   - `ENABLE_ENTERPRISE_SECURITY=false`
   - `ENABLE_SSO=false`
   - `ENABLE_API_KEY_SCOPES=false`
4. Re-run recovery checks after remediation.

## Rollback notes
- SSO/policy rollback:
  - set `enforceSso=false` and `allowPasswordAuth=true` through `/api/workspace/security/policy`.
- Public API rollback:
  - disable rotated key or reset scopes via `/api/public-api-keys/:id/scopes`.
- Auth/session rollback:
  - reduce session TTL policy to default (`168`) if instability is linked to token/session churn.

