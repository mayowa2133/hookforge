# HookForge Full Captions-Parity Plan (12-Month, Web-First, Mobile-Next)

## Summary
Goal: bring HookForge from template MVP to full-stack AI video platform parity with Captions/Mirage feature surface, while preserving production reliability and strong abuse controls.

Locked decisions:
1. URL ingestion parity is allowed (including link-based workflows).
2. Delivery is web-first, then mobile.
3. Roadmap is phased over 12 months.
4. AI stack is hybrid vendor + in-house evolution.
5. Pricing is subscription + usage credits.
6. Security target is SMB/creator baseline first.
7. Language rollout is English + top 10 first, then expansion.
8. Voice/avatar cloning requires strict consent verification.

## Phase 0 (Weeks 1-4): Foundation and parity scaffolding
1. Freeze feature manifest and acceptance criteria.
2. Add new schema and dual-write infrastructure.
3. Introduce job orchestration and provider abstraction layer.
4. Add observability baseline: traces, metrics, cost-per-feature dashboards.
5. Deliverable: stable backbone with no user-facing regressions.

## Phase 1 (Weeks 5-10): Manual editor parity
1. Build timeline graph editor with split/merge/reorder/trim/transitions/keyframes.
2. Add multi-track audio, voiceover, music/sfx library support.
3. Add media overlay with transform and caption-aware placement.
4. Add export presets and project version history.
5. Deliverable: manual editing parity core on web.

## Phase 2 (Weeks 11-16): Captions + AI edit + chat edit
1. ASR-based auto captions with word timing and style presets.
2. Caption translation for top 10 languages.
3. AI Edit style packs with auto b-roll/sfx/music insertion.
4. Chat-based editing with operation planner + undo stack.
5. Deliverable: text-first editing and one-click polish.

## Phase 3 (Weeks 17-24): AI creator stack
1. Prompt/script/audio to talking video generation.
2. AI actors + AI twin onboarding flow.
3. AI Echo voice-record flow and voice clone management.
4. Teleprompter + camera capture module on web.
5. Deliverable: creator can produce video from idea without filming.

## Phase 4 (Weeks 25-32): Ads, shorts, and URL workflows
1. AI Ads from website URL with editable generated ad script.
2. AI Shorts from long upload and YouTube URL ingestion.
3. Reddit-to-video flow from URL + post context extraction.
4. Rights/compliance flow: attestation, source auditing, takedown tooling.
5. Deliverable: growth/marketing use cases and repurposing workflows.

## Phase 5 (Weeks 33-40): Dubbing/lipdub + public API
1. Multi-language translation and dubbing jobs.
2. Lip-sync dubbing pipeline for single-speaker videos.
3. Public API and API key dashboard with credit metering.
4. Deliverable: localization and developer channel monetization.

## Phase 6 (Weeks 41-52): Mobile + commercial hardening
1. iOS app parity for top workflows.
2. Android app parity for top workflows.
3. Subscription tiers, credit pack purchases, usage alerts.
4. Collaboration baseline: workspace members, roles, shared projects.
5. Deliverable: production launch across web + mobile with monetization.

## Acceptance metrics
- Render success rate >= 99.0%
- AI job success rate >= 97.5%
- p95 project open <= 2.5s
- p95 preview render start <= 4s
- ASR WER (English) <= 10%
- ASR WER (Top-10 langs) <= 15%
- Lip sync drift <= 80ms median

## Tracking
- Progress checklist source: `progress/progress.json`
- Human-readable tracker: `progress/PROGRESS.md`
- Update script: `scripts/update-progress.ts`
