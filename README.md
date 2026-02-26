# HookForge

HookForge is a production-minded MVP for creators to generate short-form videos from curated structural templates.

- Pick a "Popular Visual Hooks" template
- Upload your own assets into required slots
- Preview instantly in-browser with Remotion Player
- Queue cloud rendering and download final MP4

## Compliance First

HookForge is intentionally designed to be rights-safe.

- Upload only content you own or have permission to use.
- URL ingestion is available only with rights attestation and trust-event auditing.
- HookForge does **not** perform unauthorized ripping/downloading or copyright circumvention.
- Templates are structural blueprints, not copyrighted clip replicas.

## Tech Stack

- Node.js 20+, TypeScript
- pnpm
- Next.js (App Router) + React
- Tailwind + shadcn/ui-style components
- Zustand (editor state)
- Prisma + Postgres
- Redis + BullMQ
- S3-compatible storage (MinIO local, AWS S3 in prod)
- Remotion + `@remotion/renderer` for local cloud-worker rendering

## Local Setup

### 1) Start local services

```bash
docker-compose up -d
```

Services:
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- MinIO API: `localhost:9000`
- MinIO Console: `localhost:9001`

### 2) Configure environment

```bash
cp .env.example .env
```

Required variables are documented in `.env.example`.

Slice 1 cutover flags:
- `ENABLE_PROJECTS_V2=true` enables `/api/projects-v2` namespace.
- `ENABLE_OPENCUT_EDITOR=true` enables the OpenCut shell as the default projects-v2 editor.
- `ENABLE_ENTERPRISE_SECURITY=true` enables enterprise security/admin surfaces.
- `ENABLE_SSO=true` enables OIDC/SAML route surfaces.
- `ENABLE_API_KEY_SCOPES=true` enables scope checks and per-key rate ceilings on public API traffic.
- `OPENCUT_EDITOR_COHORT=all` is the immediate-replacement default.
- `OPENCUT_EDITOR_INTERNAL_DOMAIN=hookforge.local` marks internal cohort email-domain gate.
- `OPENCUT_EDITOR_BETA_ALLOWLIST=` comma-separated beta allowlist emails.
- `NEXT_PUBLIC_AI_EDITOR_DEFAULT=true` makes AI editor creation the dashboard default CTA.
- `NEXT_PUBLIC_SHOW_TEMPLATES_NAV=false` relabels top-nav template entry to Quick Start.
- `AI_EDITOR_DEFAULT_TEMPLATE_SLUG=green-screen-commentator` fallback template for seeded AI-editor project creation.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` enable managed Studio Room join tokens for remote recording.

### 3) Install dependencies

```bash
# If pnpm is not already installed:
# corepack enable && corepack prepare pnpm@9.12.3 --activate
pnpm install
```

### 4) Initialize database

```bash
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm db:backfill:projects-v2
pnpm db:backfill:transcript-segments
```

If you plan to edit the schema locally, use `pnpm db:migrate` for iterative migration creation.
Seeding inserts the 5 required templates.

If you pulled the parity scaffold update into an existing local DB, run migrations before starting:

```bash
pnpm db:deploy
```

If Prisma migration bookkeeping is out of sync with an already-reconciled local schema
(for example: schema objects exist but `_prisma_migrations` has a failed/pending row),
run the local repair utility once and then continue with normal commands:

```bash
pnpm db:repair:migration-state
pnpm db:deploy
```

`db:repair:migration-state` is for local development recovery only and should not be
used as a substitute for normal migration rollout in production environments.

To backfill only active legacy projects (default statuses: `DRAFT,READY,RENDERING`) into `ProjectV2`:

```bash
pnpm db:backfill:projects-v2
# optional explicit status set:
# pnpm db:backfill:projects-v2 -- --statuses DRAFT,READY,RENDERING,DONE
```

To materialize transcript segments for existing projects/caption rows:

```bash
pnpm db:backfill:transcript-segments
```

### 5) Run app and worker

In terminal A:

```bash
pnpm dev
```

In terminal B:

```bash
pnpm worker
```

Open: `http://localhost:3000`

Creator Studio: `http://localhost:3000/creator`
Growth Lab: `http://localhost:3000/growth`
Localization Lab: `http://localhost:3000/localization`
Launch Console: `http://localhost:3000/launch`
Mobile Beta Guide: `http://localhost:3000/mobile`
OpenCut shell entrypoint (cohort gated): `http://localhost:3000/opencut/projects-v2/<projectV2Id>`
Enterprise Security Center: `http://localhost:3000/settings/security`

## End-to-End Render Flow

1. Register or login.
2. Open Dashboard.
3. Create a project from a template, or create a freeform AI-editor project in `FREEFORM` mode.
4. Upload required slot assets in `/projects/[id]`.
5. Adjust template controls and preview.
6. Click **Render MP4**.
7. Polling updates render progress.
8. Download completed MP4 from the render panel.

## API Endpoints

Implemented route handlers:

- `POST /api/projects` create project
- `GET /api/projects` list current user projects
- `POST /api/projects-v2` create AI-editor project in projects-v2 namespace
- `GET /api/projects-v2` list projects-v2 for current workspace
- `GET /api/projects-v2/:id` fetch projects-v2 details + legacy bridge metadata
- `GET /api/projects-v2/:id/editor-state` unified v2 editor state payload (project, media, transcript, timeline)
- `POST /api/projects-v2/:id/media/import` v2 freeform media presign
- `POST /api/projects-v2/:id/media/register` v2 freeform media register + timeline append
- `POST /api/projects-v2/:id/recordings/session` start recording session (mode, multipart plan, upload topology)
- `POST /api/projects-v2/:id/recordings/session/:sessionId/chunk` get chunk upload URL or confirm uploaded chunk
- `GET /api/projects-v2/:id/recordings/session/:sessionId` fetch recording upload/finalize progress
- `POST /api/projects-v2/:id/recordings/session/:sessionId/finalize` complete upload, register media, queue transcript
- `POST /api/projects-v2/:id/recordings/session/:sessionId/cancel` cancel upload session and abort multipart upload
- `POST /api/projects-v2/:id/recordings/session/:sessionId/recover` recover/resume a failed or canceled recording session
- `GET /api/projects-v2/:id/studio/rooms` list Studio Rooms for the project (status, participants, artifact counts)
- `POST /api/projects-v2/:id/studio/rooms` create Studio Room for remote multi-guest recording
- `GET /api/projects-v2/:id/studio/rooms/:roomId` fetch Studio Room metadata + participants
- `POST /api/projects-v2/:id/studio/rooms/:roomId/join-token` issue Studio participant token
- `POST /api/projects-v2/:id/studio/rooms/:roomId/start-recording` mark Studio recording start
- `POST /api/projects-v2/:id/studio/rooms/:roomId/stop-recording` mark Studio recording stop, materialize artifacts, and link deterministic clips into timeline revisions
- `GET /api/projects-v2/:id/timeline` v2 timeline fetch
- `PATCH /api/projects-v2/:id/timeline` v2 timeline patch
- `GET /api/projects-v2/:id/editor-health` v2 editor sync/queue/render readiness snapshot
- `GET /api/projects-v2/presets` quick-start preset catalog
- `POST /api/projects-v2/:id/presets/apply` apply quick-start preset macro to v2 project
- `POST /api/projects-v2/:id/chat/plan` deterministic chat plan (preview)
- `POST /api/projects-v2/:id/chat/apply` apply approved chat plan with invariant checks (`planRevisionHash` required)
- `POST /api/projects-v2/:id/chat/undo` undo chat apply by undo token
- `POST /api/projects-v2/:id/autopilot/plan` create scoped autopilot plan with grouped diffs/confidence rationale
- `POST /api/projects-v2/:id/autopilot/apply` apply autopilot plan using hash-gated payload and optional op decisions
- `POST /api/projects-v2/:id/autopilot/undo` undo autopilot apply with lineage guardrails
- `POST /api/projects-v2/:id/autopilot/replay` replay prior autopilot session with optional immediate apply
- `GET /api/projects-v2/:id/autopilot/sessions` list autopilot sessions and actions
- `POST /api/projects-v2/:id/render/final` enqueue final render for v2 project
- `GET /api/projects/:id` fetch project + assets
- `PATCH /api/projects/:id` update config/title
- `POST /api/projects/:id/assets/presign` create presigned upload URL
- `POST /api/projects/:id/assets/register` register uploaded asset + metadata
- `POST /api/projects/:id/render` enqueue render job
- `GET /api/render-jobs/:id` render status + output URL
- `POST /api/recipe/analyze` upload-only reference hook analyzer
- `POST /api/media/import-url` URL ingestion scaffold with rights attestation
- `GET /api/projects/:id/timeline` fetch timeline state + revision metadata
- `POST /api/projects/:id/timeline` append timeline patch revision
- `POST /api/projects/:id/captions/auto` queue auto-caption generation
- `POST /api/projects/:id/captions/translate` queue caption translation
- `GET /api/projects/:id/transcript` fetch transcript segments + words + quality summary
- `POST /api/projects/:id/transcript/auto` queue transcript generation/materialization (caption-compatible)
- `PATCH /api/projects/:id/transcript` apply deterministic transcript edit operations with conservative ripple gating
- `GET /api/projects-v2/:id/transcript` projects-v2 alias of transcript fetch
- `POST /api/projects-v2/:id/transcript/auto` projects-v2 alias of transcript auto
- `PATCH /api/projects-v2/:id/transcript` projects-v2 alias of transcript patch
- `GET /api/projects-v2/:id/transcript/search` transcript segment search with match offsets
- `GET /api/projects-v2/:id/transcript/ranges` transcript segment-to-word range windows for long-form editing
- `POST /api/projects-v2/:id/transcript/ranges/preview` preview delete-range operation from word indices
- `POST /api/projects-v2/:id/transcript/ranges/apply` apply delete-range operation from word indices
- `POST /api/projects-v2/:id/transcript/speakers/batch` batch speaker relabel with optional confidence filter
- `GET /api/projects-v2/:id/transcript/issues` low-confidence/overlap/timing-drift issue queue
- `GET /api/projects-v2/:id/transcript/conflicts` persisted checkpoint-linked transcript conflict queue
- `POST /api/projects-v2/:id/transcript/ops/preview` transcript op preview (no destructive apply)
- `POST /api/projects-v2/:id/transcript/ops/apply` transcript op apply path
- `POST /api/projects-v2/:id/transcript/search-replace/preview` transcript search/replace preview
- `POST /api/projects-v2/:id/transcript/search-replace/apply` transcript search/replace apply
- `POST /api/projects-v2/:id/transcript/checkpoints/create` create transcript checkpoint snapshot
- `GET /api/projects-v2/:id/transcript/checkpoints` list transcript checkpoints
- `POST /api/projects-v2/:id/transcript/checkpoints/:checkpointId/restore` restore transcript checkpoint and rebuild captions
- `POST /api/projects/:id/ai-edit` queue one-click AI edit pipeline
- `POST /api/projects/:id/chat-edit` deterministic chat-edit planner + revision append
- `POST /api/ai-creator/generate` queue creator generation flow
- `GET /api/ai-creator/actors` list creator actor presets
- `GET /api/ai-creator/profiles` list voice profiles, clones, twins, and consent records
- `POST /api/ai-creator/voice-clones` consent-tracked voice clone onboarding
- `POST /api/ai-creator/echo/presign` presigned upload for recorded AI Echo voice sample
- `POST /api/ai-creator/echo/submit` AI Echo submit + training job enqueue
- `GET/POST /api/ai-creator/twins` AI twin catalog and onboarding
- `POST /api/ai-creator/teleprompter/assist` deterministic script assist for teleprompter
- `POST /api/ai-ads/generate` queue ad generation flow
- `POST /api/ai-shorts/generate` queue shorts generation flow
- `POST /api/reddit-to-video/generate` queue Reddit-to-video flow
- `GET /api/compliance/audit` rights/source/trust event audit summary
- `POST /api/compliance/takedown` record takedown and disable source link attestations
- `POST /api/dubbing/submit` queue dubbing/lipsync jobs with credit estimation
- `GET /api/credits/balance` workspace credit balance
- `GET /api/credits/ledger` workspace credit ledger entries
- `POST /api/credits/preflight` guardrail preflight for estimated credit usage
- `GET /api/public-api-keys` list workspace API keys
- `POST /api/public-api-keys` create workspace API key (secret returned once)
- `POST /api/public-api-keys/:id/disable` disable API key
- `POST /api/public-api-keys/:id/rotate` rotate API key with overlap window
- `POST /api/public-api-keys/:id/scopes` update API key scopes + per-key rate ceiling
- `GET /api/workspace/members` list workspace members
- `POST /api/workspace/members` add/update workspace member role
- `PATCH /api/workspace/members/:memberId` update member role
- `DELETE /api/workspace/members/:memberId` remove workspace member
- `GET /api/workspace/security/policy` read workspace security policy
- `POST /api/workspace/security/policy` update workspace security policy
- `GET /api/workspace/security/sso/providers` list OIDC/SAML providers
- `POST /api/workspace/security/sso/providers` create OIDC/SAML provider
- `PATCH /api/workspace/security/sso/providers/:id` update provider
- `GET /api/workspace/projects` list shared workspace projects
- `POST /api/projects-v2/:id/review/requests` create explicit review request
- `POST /api/projects-v2/:id/review/requests/:requestId/decision` approve/reject request and persist decision log
- `POST /api/projects-v2/:id/publish/connectors/:connector/export` queue connector export job (`youtube|drive|package`)
- `GET /api/projects-v2/:id/publish/jobs/:jobId` fetch publish connector job status/result
- `GET /api/billing/plans` plan and credit-pack catalog
- `GET /api/billing/overview` billing + usage overview
- `POST /api/billing/subscribe` activate subscription tier
- `POST /api/billing/credit-packs/purchase` purchase one-time credits
- `GET /api/billing/usage-alerts` derive credit usage alerts
- `GET /api/billing/anomalies` list workspace usage anomalies
- `POST /api/billing/anomalies/scan` run workspace anomaly detection scan
- `POST /api/billing/anomalies/:id/status` acknowledge or resolve an anomaly
- `POST /api/billing/reconcile` run subscription + ledger reconciliation checks
- `GET /api/workspace/audit` immutable workspace audit trail events
- `GET /api/workspace/audit/events` audit query endpoint with actor/action/date filters
- `POST /api/auth/sso/oidc/start` start OIDC login
- `GET /api/auth/sso/oidc/callback` OIDC callback completion
- `POST /api/auth/sso/saml/acs` SAML ACS endpoint
- `GET /api/auth/sso/saml/metadata` SAML metadata endpoint
- `GET /api/ops/slo/summary` reliability SLO rollup (render/AI success + p95)
- `GET /api/ops/queues/health` queue backlog and failed-job health
- `POST /api/ops/recovery/backup-verify` recovery verification drill + incident trace
- `GET /api/mobile/config` mobile rollout and quick-link config
- `GET /api/mobile/health` mobile reliability + quality-system health signal
- `POST /api/mobile/uploads/resumable/initiate` start resumable multipart upload session
- `POST /api/mobile/uploads/resumable/:sessionId/part-url` fetch signed URL for an upload part
- `POST /api/mobile/uploads/resumable/:sessionId/part-complete` confirm uploaded part ETag
- `GET /api/mobile/uploads/resumable/:sessionId` resumable upload progress + recovery state
- `POST /api/mobile/uploads/resumable/:sessionId/complete` finalize upload and register asset
- `POST /api/mobile/uploads/resumable/:sessionId/abort` abort resumable upload session
- `POST /api/mobile/telemetry` ingest mobile reliability/perf telemetry events
- `GET /api/mobile/workflows/top` mobile-vs-web completion parity for top workflows
- `POST /api/quality/evals/run` trigger quality eval execution and gate scoring
- `GET /api/quality/evals/:id` read eval-run status/results
- `GET /api/quality/metrics` read quality/routing/anomaly dashboard payload
- `POST /api/quality/feedback` submit structured quality feedback
- `GET /api/models/route-policy` list model routing policies
- `POST /api/models/route-policy` upsert model routing policy with quality-gate enforcement
- `GET /api/parity/scorecard` read parity module scorecard for current workspace
- `POST /api/parity/benchmarks/run` run persisted parity benchmark execution
- `GET /api/parity/benchmarks/:runId` fetch benchmark run summary/results

Descript+ program validation commands:

- `pnpm test:e2e:descript-plus`
- `pnpm quality:parity-gate`
- baseline report artifact: `progress/DESCRIPT_PLUS_BASELINE_REPORT.md`

Autopilot Phase 4 highlights:

- Planner packs: `timeline`, `transcript`, `captions`, `audio`, `publishing`
- Macro shortcuts: `tighten_pacing`, `remove_filler_normalize_audio`, `social_cut_from_range`, `speaker_cleanup_chaptering`
- Replay flow: `POST /api/projects-v2/:id/autopilot/replay` supports safe re-plan and optional immediate apply with lineage safeguards

Public API scaffold:

- `GET /api/public/v1/translate/supported-languages`
- `POST /api/public/v1/translate/submit`
- `GET /api/public/v1/translate/status/:id`
- `POST /api/public/v1/translate/estimate`

Create a public API key for local testing:

```bash
pnpm api:key -- --email you@example.com --name "Local Translate Key"
```

Use the returned key with `Authorization: Bearer <key>` or `x-api-key`.

Auth routes:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`

## Implemented Templates (5)

1. Green Screen Commentator
2. Tweet/Comment Pop-up Reply
3. 3-Beat Montage Intro + Main Talk
4. Split-screen Reaction
5. Fake FaceTime / Incoming Call opener

Each template is wired end-to-end:

- slot schema
- editor controls
- Remotion preview
- worker render output

## Recipe Card Generator (MVP-safe)

`/api/recipe/analyze` accepts a **user-uploaded** reference video and returns:

- deterministic heuristics (scene cuts estimate, motion intensity, text density approximation)
- best-match template suggestion
- recipe card tips
- optional LLM enhancement behind `ENABLE_LLM_RECIPE=true`

If LLM is enabled without an API key, a mock/stub enhancement is returned.

## Object Storage Notes

- Uploads use presigned `PUT` URLs.
- Assets are stored under `projects/{projectId}/...`.
- Render outputs are stored under `renders/{projectId}/...`.

## Rendering Architecture

- `worker/index.ts` handles BullMQ jobs and renders with `@remotion/renderer`.
- `lib/render/props.ts` maps project/template data into composition props.
- `remotion/` contains one composition per template.
- This separation is designed so the execution layer can later move to Remotion Lambda without rewriting template logic.

## Phase 0 Parity Scaffold (Implemented)

The repository now includes parity-ready foundations for the 12-month roadmap:

- Expanded Prisma domain for workspaces, plans/subscriptions, credits, timeline graph, AI jobs, trust/safety, consent, media artifacts, and public API keys.
- Queue topology extensions: `ingest`, `transcribe`, `caption-style`, `translate`, `dub-lipsync`, `ai-edit`, `ai-generate`, `render-preview`, `render-final`, `notify`, `billing-meter`.
- AI orchestration layer with provider registry and deterministic mock adapters (safe defaults until provider keys are configured).
- Worker now processes both render jobs and AI jobs.
- New environment variables in `.env.example` for provider keys, starter credits, URL import controls, and language defaults.

Important:
- URL ingestion endpoints are implemented as rights-attested scaffolding and queue jobs.
- No direct ripping/downloading logic from social platforms is implemented in this repo.

## OpenCut Adoption Phase 0 (Implemented)

Implemented for the OpenCut adoption track:

- OpenCut editor feature-flag scaffolding in env + cutover logic (`ENABLE_OPENCUT_EDITOR`, `OPENCUT_EDITOR_COHORT`, internal/beta gates)
- Project-v2 shell resolution helper (`LEGACY` vs `OPENCUT`) with cohort evaluation by user email
- Public compliance docs for OpenCut fork/legal baseline tracking:
  - `docs/legal/OPENCUT_LICENSE_COMPLIANCE.md`
  - `docs/legal/OPENCUT_UPSTREAM_BASELINE.md`
- Upstream sync automation script:
  - `scripts/sync-opencut-upstream.sh`
  - `pnpm opencut:sync-upstream`

## OpenCut Adoption Phase 1 (Implemented)

Implemented:

- Added cohort-aware projects-v2 entrypoint resolver for `LEGACY` vs `OPENCUT` shell routing.
- Added transcript-first OpenCut editor shell route:
  - `/opencut/projects-v2/[id]`
- Added OpenCut client adapter for HookForge APIs:
  - `lib/opencut/hookforge-client.ts`
- Wired `/projects-v2/[id]` to redirect users by shell cohort and legacy bridge availability.
- Updated projects-v2 API payloads with `editorShell` + cohort-resolved `entrypointPath`.
- Added OpenCut adapter and cutover tests:
  - `tests/opencut-client.test.ts`
  - `tests/editor-cutover.test.ts`

## OpenCut Adoption Phase 2 (Implemented)

Implemented:

- Timeline operation support in OpenCut adapter client:
  - `split_clip`
  - `trim_clip`
  - `move_clip`
  - `set_clip_timing`
  - `merge_clip_with_next`
  - `remove_clip`
  - `reorder_track`
- Interactive timeline controls in OpenCut shell:
  - track reorder up/down
  - clip selection + move/timing/trim/split/merge/remove controls
  - timeline revision feedback after apply
- Keyboard shortcuts in OpenCut shell:
  - `Space` play/pause
  - `J/K/L` seek/pause controls
  - `S` split selected clip at playhead
- Utility helpers and tests for split, seek clamping, and reorder bounds:
  - `lib/opencut/timeline-helpers.ts`
  - `tests/opencut-timeline-helpers.test.ts`
- Regression validation:
  - `pnpm test`
  - `pnpm test:e2e:slice12`

## OpenCut Adoption Phase 3 (Implemented)

Implemented:

- Added AI chat-edit integration into the OpenCut shell using bridgeable project APIs:
  - `POST /api/projects/:id/chat-edit`
  - `POST /api/projects/:id/chat-edit/undo`
- Added typed OpenCut adapter methods for chat apply/undo:
  - `runChatEdit()`
  - `undoChatEdit()`
- Added OpenCut shell Co-Editor panel with:
  - natural-language prompt input
  - optional attachment asset IDs input
  - execution-mode output (`APPLIED` vs `SUGGESTIONS_ONLY`)
  - confidence, fallback reason, invariant issue reporting
  - planned operation summaries
  - undo-token driven restore flow
  - AI job progress polling for chat-edit jobs
- Validation coverage updated:
  - `tests/opencut-client.test.ts`
  - `pnpm test`
  - `pnpm test:e2e:slice12`

## OpenCut Adoption Phase 4 (Implemented)

Implemented:

- Added media upload flow directly in the OpenCut shell:
  - required/optional slot cards from template slot schema
  - direct `presign -> PUT upload -> register` flow per slot
  - slot-level upload errors and status badges
  - required-slot readiness summary before render
- Added typed OpenCut client methods for upload/register:
  - `presignProjectAsset()`
  - `registerProjectAsset()`
- Added render gating and export polish:
  - final render button is blocked until required slots are uploaded
  - render/export panel now surfaces readiness guidance and download output when done
- Validation coverage updated:
  - `tests/opencut-client.test.ts`
  - `pnpm test`
  - `pnpm test:e2e:slice12`

## OpenCut Adoption Phase 5 (Implemented)

Implemented:

- Added OpenCut telemetry ingestion API:
  - `POST /api/opencut/telemetry`
  - tracks: `editor_open`, `transcript_edit_apply`, `chat_edit_apply`, `render_start`, `render_done`, `render_error`
- Added OpenCut metrics summary API:
  - `GET /api/opencut/metrics?windowHours=24`
  - returns per-event totals + success/error split + success rate
- Integrated telemetry emission in OpenCut shell:
  - editor open tracking
  - transcript apply success/error tracking
  - chat apply success/error tracking
  - render start/done/error tracking
- Added rollout visibility panel in OpenCut shell with 24h success/error snapshot.
- Rollback mechanism remains immediate via:
  - `ENABLE_OPENCUT_EDITOR=false`
  - or cohort controls (`OPENCUT_EDITOR_COHORT=internal|beta|all`)
- Validation coverage updated:
  - `tests/opencut-client.test.ts`
  - `tests/opencut-metrics.test.ts`
  - `pnpm test`
  - `pnpm test:e2e:slice12`

## Descript-First UX Replacement (Implemented)

Implemented on `/opencut/projects-v2/[id]`:

- Replaced card-style shell with fixed editor IA:
  - left rail for media/scenes/quick actions/history
  - center transcript-first canvas
  - right preview/inspector/chat co-editor
  - expandable bottom timeline rail
- Transcript depth improvements:
  - search/jump to segments
  - word-range selection
  - preview-first ripple delete (`transcript/ops/preview`)
  - apply path (`transcript/ops/apply`) with issues surface
  - low-confidence badges and speaker relabel/split/merge controls
- Timeline ergonomics:
  - compact lane view with collapse/reorder
  - clip move/trim/split/merge/remove controls
  - CapCut-style shortcuts:
    - `Cmd/Ctrl+B` split at playhead
    - `Delete` ripple delete selected clip/segment
    - `Shift+D` duplicate selected clip
    - `[` and `]` trim in/out to playhead
    - `Space`, `J/K/L` transport
- Chat co-editor strict flow:
  - plan -> grouped diff review -> apply
  - apply requires `planRevisionHash`
  - one-click undo with lineage checks
- Reliability UX:
  - editor health status chip via `GET /api/projects-v2/:id/editor-health`
  - queue/render readiness surfaced in editor
  - operation history and autosave state

Validation:

- `pnpm test`
- `pnpm test:e2e:freeform`
- `pnpm test:e2e:slice12`
- `pnpm test:e2e:phase01234567-enterprise`

## Descript 6-Month Phase 3 Audio Quality Stack (Implemented)

Implemented on `/opencut/projects-v2/[id]` and projects-v2 APIs:

- Audio analysis and quality controls:
  - `GET /api/projects-v2/:id/audio/analysis`
  - `POST /api/projects-v2/:id/audio/enhance/preview`
  - `POST /api/projects-v2/:id/audio/enhance/apply`
  - `POST /api/projects-v2/:id/audio/enhance/undo`
  - `POST /api/projects-v2/:id/audio/filler/preview`
  - `POST /api/projects-v2/:id/audio/filler/apply`
  - `POST /api/projects-v2/:id/audio/ab/segment`
  - `GET /api/projects-v2/:id/audio/runs/:runId`
- Non-destructive revision flow:
  - enhancement applies as timeline-safe ops with rollback/undo lineage
  - filler removal runs transcript-aware preview before apply
  - confidence-aware safety mode (`AUTO_APPLY`, `APPLY_WITH_CONFIRM`, `PREVIEW_ONLY`)
  - apply-with-confirm gate enforced for medium-confidence destructive ops
- Persistence and traceability:
  - `AudioEnhancementRun` records enhancement preview/apply runs
  - `FillerCandidate` records detected filler spans and status
- UI integration:
  - OpenCut shell Audio Quality panel with denoise/clarity/de-esser/normalize toggles, solo+bypass audition switches, segment A/B metadata preview, and preview/apply/undo operation history

Validation:

- `pnpm test`
- `pnpm test:e2e:descript-core`
- `pnpm test:e2e:phase01234567-enterprise`

## Descript 6-Month Phase 4 Chat Co-Editor V2 (Implemented)

Implemented on `/opencut/projects-v2/[id]` and projects-v2 APIs:

- Structured plan payload:
  - grouped diffs across `timeline`, `transcript`, `captions`, and `audio`
  - safety mode classification (`APPLIED`, `APPLY_WITH_CONFIRM`, `SUGGESTIONS_ONLY`)
  - confidence rationale (average confidence, valid plan rate, reasons, fallback reason)
- Selective apply contract:
  - `POST /api/projects-v2/:id/chat/apply` now supports per-operation decisions:
    - `operationDecisions: [{ itemId, accepted }]`
  - strict `planRevisionHash` gating retained
  - apply returns selected/total operation counts
- Lineage and visibility:
  - `POST /api/projects-v2/:id/chat/undo` supports lineage mode (`latest` or `force`)
  - `GET /api/projects-v2/:id/chat/sessions` for plan/apply history
  - `GET /api/projects-v2/:id/revisions/graph` for revision lineage graph
- UI integration:
  - OpenCut shell supports operation-by-operation toggles before apply
  - chat sessions summary and revision lineage panel rendered in editor
  - apply button enforces at least one selected operation on applied plans

Validation:

- `pnpm test`
- `pnpm test:e2e:descript-core`
- `pnpm test:e2e:freeform`
- `pnpm test:e2e:slice12`
- `pnpm test:e2e:phase01234567-enterprise`

## Descript 6-Month Phase 5 Collaboration/Review/Publishing (Implemented)

Implemented on `/opencut/projects-v2/[id]` and projects-v2 APIs:

- Share links and scoped review access:
  - `GET/POST /api/projects-v2/:id/share-links`
- Review loop with anchored comments:
  - `GET/POST /api/projects-v2/:id/review/comments`
  - `PATCH /api/projects-v2/:id/review/comments/:commentId`
- Explicit approve/reject decision workflow:
  - `POST /api/projects-v2/:id/review/approve`
- Publish/export profile workflow:
  - `GET/POST /api/projects-v2/:id/export/profile`
- Render approval gate enforcement:
  - `POST /api/projects-v2/:id/render/final` now blocks render when approval is required and latest revision is not approved.

Data model additions:

- `ShareLink`, `ReviewComment`, `ReviewDecision`, `ExportProfile`
- Enums: `ShareLinkScope`, `ReviewCommentStatus`, `ReviewDecisionStatus`

UI integration:

- OpenCut shell collaboration panel:
  - share-link generation/list
  - timestamp/transcript-anchored review comments with resolve/reopen
  - approve/reject controls with approval-required toggle
  - export profile apply/create controls

Validation:

- `pnpm test`
- `pnpm test:e2e:descript-core`
- `pnpm test:e2e:freeform`
- `pnpm test:e2e:slice12`
- `pnpm test:e2e:phase01234567-enterprise`

## Descript 6-Month Phase 6 Desktop Shell + Hard Cutover (Implemented)

Implemented on `/opencut/projects-v2/[id]` and supporting desktop APIs:

- Immediate replacement cutover:
  - `OPENCUT_IMMEDIATE_REPLACEMENT=true` makes OpenCut shell default for projects-v2.
  - Hidden rollback control via `OPENCUT_LEGACY_FALLBACK_ALLOWLIST` for incident response.
- Desktop shell support endpoints:
  - `GET /api/desktop/config` (desktop capabilities, shortcuts, cutover state, perf budgets)
  - `POST /api/desktop/events` (desktop telemetry ingestion)
  - `GET /api/projects-v2/:id/perf-hints` (project-specific perf hints and p95 observations)
- Editor UX hardening for desktop daily-driver behavior:
  - Local file drag/drop + file-picker import directly in OpenCut shell
  - Upload/render completion notifications (browser notification API)
  - Desktop performance panel (p95 open/command vs budget + suggested virtualization windows)
  - Desktop event instrumentation for boot, command latency, drop imports, and notifications

Validation:

- `pnpm test`
- `pnpm test:e2e:descript-core`
- `pnpm test:e2e:freeform`
- `pnpm test:e2e:slice12`
- `pnpm test:e2e:phase01234567-enterprise`

## Freeform + Chat-First Cutover (Implemented)

Implemented:

- `FREEFORM` creation in `/api/projects-v2` no longer requires user-selected templates.
- Hidden system bridge template preserves backward-compatible render/runtime wiring without exposing template friction in v2 flows.
- OpenCut v2 shell now supports freeform media import/register and uses v2-first timeline/chat/render routes.
- Chat editing runs as explicit `plan -> apply -> undo`:
  - `POST /api/projects-v2/:id/chat/plan`
  - `POST /api/projects-v2/:id/chat/apply`
  - `POST /api/projects-v2/:id/chat/undo`
- Optional Quick Start templates are available as preset macros instead of mandatory creation path.
- Added dedicated runtime gate:
  - `pnpm test:e2e:freeform`

## Phase 1 Manual Editor (Completed)

Implemented and wired into preview + cloud render:

- Timeline graph editing: split, merge, reorder, trim, move, remove, relabel
- Multi-track audio: voiceover/music/sfx tracks, volume/mute mixing, bundled library clips
- Media overlay transforms: position, scale, opacity, rotation, transition style
- Caption track operations with caption-style effects and caption-aware placement
- Export presets + timeline-aware duration calculation
- Project version history with revision hashes and operation snapshots

The Phase 1 editor is now operational end-to-end on web.

## Phase 2 AI Captions + Edit + Chat (Completed)

Implemented:

- Auto-caption generation with ASR orchestration, confidence-gated fallback re-decode, forced alignment refinement, and style-safe segmentation
- First-class transcript engine (`TranscriptSegment`) with project transcript retrieval, auto-generation, and deterministic edit operations (`replace_text`, `split_segment`, `merge_segments`, `delete_range`, `set_speaker`, `normalize_punctuation`)
- Transcript editor controls in `/projects/[id]` with apply/preview modes, issues surface, and conservative ripple safety fallback to suggestions-only when unsafe
- Caption translation jobs for supported top languages
- AI Edit style packs applied as timeline operations
- Chat-based edit planning with apply + undo stack
- AI job polling and timeline refresh in-editor

## Phase 3 AI Creator Stack (Completed on Web)

Implemented:

- `/creator` web app for AI Creator workflows
- Prompt/script generation flow to a renderable project (`/api/ai-creator/generate`)
- AI actor preset catalog and generation mapping
- AI Echo voice record flow (presign upload + submit) with consent verification
- Voice clone and AI twin onboarding APIs with trust-event logging
- Teleprompter script assist + auto-scroll capture workflow
- In-browser camera capture + direct upload into project video slots
- End-to-end worker materialization for `AI_CREATOR` jobs

## Phase 4 Ads + Shorts + Reddit + Compliance (Completed on Web)

Implemented:

- AI Ads flow from rights-attested website URLs with editable deterministic ad script blocks
- AI Shorts flow from rights-attested source URLs (including YouTube URL workflows) with shortlist generation and editable project drafts
- Reddit-to-video generation route with context extraction and editable project draft outputs
- Compliance audit API and takedown API with trust-event logging and source-link attestation deactivation
- Growth Lab web surface (`/growth`) covering all Phase 4 workflows
- End-to-end AI side-effects for `AI_ADS` and `AI_SHORTS` in worker orchestration

## Phase 5 Dubbing + Public API (Completed on Web)

Implemented:

- Internal dubbing/lipdub submit flow with credit estimation and queue routing
- Worker-side Phase 5 side-effects that materialize downloadable dubbed/lipsync media artifacts per target language
- Public Translate API status now includes artifact download URLs
- Workspace API key management APIs (create/list/disable)
- Localization Lab web surface (`/localization`) with:
  - Internal dubbing queue + job polling
  - Public API sandbox submit/status
  - API key lifecycle controls and credit visibility

## Phase 6 Mobile + Commercial Hardening (Completed)

Implemented:

- Launch Console web surface (`/launch`) for subscription tier management, credit-pack purchases, usage alerts, and shared workspace operations
- Workspace collaboration baseline: member add/update/remove APIs and shared workspace project listing
- Subscription and credit pack commercialization endpoints with ledger integration and balance updates
- Usage alert derivation APIs for low-credit and high-burn detection
- Mobile beta support:
  - `/mobile` install and workflow guidance
  - `/api/mobile/config` for mobile quick-link/capability config
  - PWA manifest route (`/manifest.webmanifest`) for installability

## Phase 7 Commercial + Collaboration Guardrails (Completed)

Implemented:

- Credit preflight guardrail endpoint (`/api/credits/preflight`) with per-workspace limits, low-balance impact, and pack recommendation
- Reserve-credit guardrails enforced in debit flow (`reserveCredits`) with guardrail metadata written to ledger entries
- Usage anomaly detection pipeline with APIs:
  - `/api/billing/anomalies`
  - `/api/billing/anomalies/scan`
  - `/api/billing/anomalies/:id/status`
- Subscription + ledger reconciliation endpoint (`/api/billing/reconcile`) including duplicate-subscription cleanup and renewal-cycle credit checks
- Stronger collaboration role matrix (owner/admin constraints) with immutable workspace audit trail events (`/api/workspace/audit`)
- Quality metrics enrichment for billing anomalies in `/api/quality/metrics`

## Post-Phase 6 Enterprise Hardening (Completed)

Implemented:

- Enterprise identity controls:
  - Workspace-level OIDC and SAML provider configuration APIs
  - OIDC start/callback and SAML ACS/metadata routes
  - Workspace security policy with SSO enforcement (`enforceSso`) and password fallback controls
  - Session TTL policy used by credential and SSO logins
- Capability-based authorization:
  - centralized capability map in `lib/workspace-roles.ts`
  - guard helper `requireWorkspaceCapability()` used across workspace, billing, API key, and ops admin routes
- Immutable compliance trail:
  - append-only `AuditEvent` model
  - audit emission for privileged auth/policy/billing/member/API-key/ops actions
  - audit query route with filters (`/api/workspace/audit/events`)
- Public API key hardening:
  - per-key scopes and rate ceilings
  - rotation with overlap window
  - scope update endpoint and lifecycle audit events
- Single-region reliability hardening:
  - SLO summary endpoint
  - queue health endpoint
  - backup verification endpoint with `SystemIncident` trace records
- Enterprise admin UI:
  - `/settings/security` tabs for policy, SSO providers, API keys/scopes, audit feed, and ops summary

SOC2/readiness artifacts:

- `docs/compliance/SOC2_TYPE1_CHECKLIST.md`
- `docs/ops/ENTERPRISE_RECOVERY_RUNBOOK.md`

## Progress Tracker

Progress artifacts:

- `progress/progress.json` (machine-readable)
- `progress/PROGRESS.md` (generated checklist)
- `scripts/update-progress.ts`
- `progress/captions_quality_progress.json` (quality parity machine state)
- `progress/CAPTIONS_QUALITY_PARITY_PLAN.md` (generated quality parity board)
- `scripts/update-captions-quality-progress.ts`
- `docs/quality/QUALITY_GATES.md`
- `docs/quality/EVAL_DATASETS.md`
- `docs/quality/ROLLBACK_RUNBOOK.md`

Update command:

```bash
pnpm progress
pnpm progress:quality
```

## Tests

Included:

- template slot schema validation test
- render enqueue logic unit test
- chat edit planner unit test
- queue topology unit test
- timeline legacy operation coverage (timing/effect/transition/merge)
- render-props timeline integration coverage (asset manifest + timeline state parsing)

Run tests:

```bash
pnpm test
```

Run phase e2e checks:

```bash
pnpm test:e2e:slice12
pnpm test:e2e:phase012
pnpm test:e2e:phase3
pnpm test:e2e:phase4
pnpm test:e2e:phase5
pnpm test:e2e:phase6
pnpm test:e2e:trackab
pnpm test:e2e:phase0123
pnpm test:e2e:phase01234
pnpm test:e2e:phase012345
pnpm test:e2e:phase0123456
pnpm test:e2e:phase01234567
pnpm test:e2e:enterprise
pnpm test:e2e:phase01234567-enterprise
pnpm test:e2e:descript-core
```

## Security / Safety Controls

- Password hashing with bcrypt
- Signed session cookie auth (JWT)
- Zod input validation across APIs
- Upload size limit (`MAX_UPLOAD_MB`)
- Text overlay sanitation for user inputs
- No dynamic code execution from user inputs

## MVP Limitations and Next TODOs

Current limitations:

- Green screen template uses PiP framing with experimental static background cleanup (not full AI segmentation)
- Beat detection is rule-based (not audio onset ML)
- Text density heuristic is approximate
- Polling-based render updates (no websockets)

Future improvements:

- background removal model integration
- advanced beat detection and timeline editor
- richer reference-video analysis
- Remotion Lambda switch for production-scale rendering
- team/workspace permissions and signed sharing links
