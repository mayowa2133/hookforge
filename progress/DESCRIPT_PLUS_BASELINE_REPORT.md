# Descript+ Baseline Report

Generated: `2026-02-26T14:16:50Z`

## Scope

This baseline validates the Descript+ program foundation slice:

- Studio Rooms (LiveKit-managed token path + recording lifecycle)
- Transcript document operations (search/replace + checkpoints)
- Autopilot namespace (plan/apply/undo/session history)
- Review request decisions + publish connector jobs
- Parity scorecard + benchmark APIs and CI parity gate command

## Validation Results

- `pnpm db:generate`: PASS
- `tsc --noEmit`: PASS
- `pnpm test`: PASS (`44` files, `134` tests)
- `pnpm test:e2e:descript-plus`: PASS (`DESCRIPT_PLUS_E2E_SUCCESS`)
- `pnpm test:e2e:freeform`: PASS (`FREEFORM_E2E_SUCCESS`)
- `pnpm test:e2e:slice12`: PASS (`ALL_TEMPLATES_E2E_SUCCESS`, `PHASE2_E2E_SUCCESS`)
- `pnpm test:e2e:phase01234567-enterprise`: PASS (`ENTERPRISE_E2E_SUCCESS`)

## Runtime Defects Found and Fixed

1. Prisma JSON typing mismatch in benchmark/publish persistence.
2. Transcript conflict severity enum mismatch (`ERROR` -> `HIGH`).
3. Migration SQL gap: `ReviewDecisionStatus` enum not guaranteed before creating `ReviewDecisionLog`.
4. Parity gate workspace auto-selection targeted inactive workspaces; selection now prioritizes workspaces with Studio activity.

## Notes

- `prisma migrate deploy` is unstable in this environment due schema-engine/runtime constraints; SQL migration was applied directly to local Postgres for runtime verification.
- Parity gate command executes and enforces thresholds; pass/fail depends on selected workspace activity and configured thresholds (`PARITY_GATE_MIN_SCORE`, `PARITY_GATE_MIN_PASS_RATE`).
