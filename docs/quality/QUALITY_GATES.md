# HookForge Quality Gates

This document defines the promotion and rollback gates for quality-sensitive modules.

## Gate Scope

The following modules are gate-protected:

1. ASR and auto-caption generation
2. Caption translation and dubbing/lip-sync
3. AI edit and chat-edit planner execution
4. AI creator/ads/shorts generation ranking
5. Public translate API model routing

## Required Checks Before Promotion

1. Type safety: `tsc --noEmit`
2. Unit/integration tests: `vitest run`
3. Existing parity E2E chain: `pnpm test:e2e:phase0123456`
4. Quality smoke for touched capability via `/api/quality/evals/run`
5. Snapshot compare: latency, success rate, cost against previous baseline

## Promotion Thresholds

1. English WER `<= 8%`
2. Top-10 language WER `<= 12%`
3. Caption timing median `<= 80ms`, p95 `<= 180ms`
4. Dubbing MOS `>= 4.2/5`
5. Lip-sync drift median `<= 60ms`, p95 `<= 120ms`
6. Public translate API success `>= 98.5%`
7. Planner valid-plan success `>= 98%`
8. Undo correctness `>= 99.5%`

## Fail Policy

If any threshold fails:

1. Do not promote route policy to production weight.
2. Keep candidate route at canary traffic only (max 5%).
3. Create/attach a quality eval report with failing metrics.
4. Execute rollback steps from `docs/quality/ROLLBACK_RUNBOOK.md`.

## CI Integration Contract

1. CI must run an eval job for each changed capability.
2. CI must persist eval result artifacts under `progress/quality-evals/`.
3. Route policy updates are rejected unless latest eval run has `passed=true`.
