# HookForge Quality Rollback Runbook

Use this runbook when quality gates fail or production regression is detected.

## Trigger Conditions

1. Sev-1 or sev-2 quality regression in production
2. Eval-gate threshold failure on canary promotion
3. Vendor outage causing sustained quality degradation

## Immediate Response (0-15 minutes)

1. Freeze route-policy changes for affected capability.
2. Set routing policy to last known good model version (`rolloutPercent=100`).
3. Pause scheduled promotions for related tracks.
4. Post incident summary in release channel.

## Technical Rollback Steps

1. Identify failed route policy from `/api/models/route-policy`.
2. Update active policy to previous stable model version.
3. Mark bad model version status to `ROLLED_BACK`.
4. Run smoke eval via `/api/quality/evals/run` on rollback candidate.
5. Verify `/api/quality/metrics` returns healthy gate values.

## Data Integrity Checks

1. Confirm no stuck eval runs (`status=RUNNING` > SLA).
2. Confirm usage ledger is reconciled after rollback.
3. Confirm alert pipeline notifies owners of rollback event.

## Recovery Exit Criteria

1. Two consecutive green eval runs for failed capability
2. No new sev-1/sev-2 quality incidents in 24h window
3. Canary pass at 5% then 25% before full rollout

## Postmortem Requirements

1. Root-cause classification (model, provider, orchestration, data)
2. Failing metric timeline and blast radius
3. Corrective/preventive actions with owners and dates
