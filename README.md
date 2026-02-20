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
```

If you plan to edit the schema locally, use `pnpm db:migrate` for iterative migration creation.
Seeding inserts the 5 required templates.

If you pulled the parity scaffold update into an existing local DB, run migrations before starting:

```bash
pnpm db:deploy
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

## End-to-End Render Flow

1. Register or login.
2. Open Dashboard.
3. Create a project from a template.
4. Upload required slot assets in `/projects/[id]`.
5. Adjust template controls and preview.
6. Click **Render MP4**.
7. Polling updates render progress.
8. Download completed MP4 from the render panel.

## API Endpoints

Implemented route handlers:

- `POST /api/projects` create project
- `GET /api/projects` list current user projects
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
- `GET /api/public-api-keys` list workspace API keys
- `POST /api/public-api-keys` create workspace API key (secret returned once)
- `POST /api/public-api-keys/:id/disable` disable API key
- `GET /api/workspace/members` list workspace members
- `POST /api/workspace/members` add/update workspace member role
- `PATCH /api/workspace/members/:memberId` update member role
- `DELETE /api/workspace/members/:memberId` remove workspace member
- `GET /api/workspace/projects` list shared workspace projects
- `GET /api/billing/plans` plan and credit-pack catalog
- `GET /api/billing/overview` billing + usage overview
- `POST /api/billing/subscribe` activate subscription tier
- `POST /api/billing/credit-packs/purchase` purchase one-time credits
- `GET /api/billing/usage-alerts` derive credit usage alerts
- `GET /api/mobile/config` mobile rollout and quick-link config
- `GET /api/mobile/health` mobile reliability + quality-system health signal
- `POST /api/quality/evals/run` trigger quality eval execution and gate scoring
- `GET /api/quality/evals/:id` read eval-run status/results
- `GET /api/quality/metrics` read quality/routing/anomaly dashboard payload
- `POST /api/quality/feedback` submit structured quality feedback
- `GET /api/models/route-policy` list model routing policies
- `POST /api/models/route-policy` upsert model routing policy with quality-gate enforcement

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
