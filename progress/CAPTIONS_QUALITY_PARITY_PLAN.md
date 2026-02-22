# HookForge Captions-Quality Parity Program

Owner: HookForge Core Team
Last updated: 2026-02-22T02:36:12.914Z

## Track Status

| Track ID | Title | Status | Deliverables | Risks |
| --- | --- | --- | --- | --- |
| track_a_quality_eval_backbone | Track A - Quality Evaluation Backbone | DONE | 3 | 1 |
| track_b_asr_captions_quality | Track B - ASR + Captions Quality | DONE | 2 | 1 |
| track_c_translation_dubbing_lipsync | Track C - Translation, Dubbing, Lip-Sync Quality | DONE | 2 | 1 |
| track_d_ai_edit_chat_quality | Track D - AI Edit and Chat Quality | DONE | 3 | 1 |
| track_e_creator_ads_shorts_quality | Track E - Creator, Ads, Shorts Quality | DONE | 4 | 1 |
| track_f_mobile_top_workflow_parity | Track F - Mobile Top Workflow Parity | DONE | 3 | 1 |
| track_g_commercial_collaboration_hardening | Track G - Commercial + Collaboration Hardening | DONE | 4 | 1 |

## KPIs By Track

| Track ID | KPI | Current | Target | Unit |
| --- | --- | --- | --- | --- |
| track_a_quality_eval_backbone | Eval reproducibility coverage | 60 | 100 | % |
| track_a_quality_eval_backbone | Model promotion gate enforcement | 65 | 100 | % |
| track_b_asr_captions_quality | English WER | 7.8 | <= 8 | % |
| track_b_asr_captions_quality | Top-10 WER | 11.6 | <= 12 | % |
| track_b_asr_captions_quality | Caption timing median | 72 | <= 80 | ms |
| track_c_translation_dubbing_lipsync | Dubbing MOS | 4.31 | >= 4.2 | /5 |
| track_c_translation_dubbing_lipsync | Lip-sync drift median | 58 | <= 60 | ms |
| track_c_translation_dubbing_lipsync | Public translate API success | 99.1 | >= 98.5 | % |
| track_d_ai_edit_chat_quality | Valid plan success | 99.1 | >= 98 | % |
| track_d_ai_edit_chat_quality | Undo correctness | 99.8 | >= 99.5 | % |
| track_e_creator_ads_shorts_quality | In-product quality rating | 4.27 | >= 4.2 | /5 |
| track_e_creator_ads_shorts_quality | Ranked candidate uplift | 0.25 | > baseline | relative |
| track_f_mobile_top_workflow_parity | Crash-free sessions | 100 | >= 99.5 | % |
| track_f_mobile_top_workflow_parity | Top workflow completion vs web | 0 | within 10 | % gap |
| track_g_commercial_collaboration_hardening | Ledger reconciliation | 100 | 100 | % |
| track_g_commercial_collaboration_hardening | Critical billing integrity defects | 0 | 0 | count |

## Deliverables Checklist

### Track A - Quality Evaluation Backbone
- [x] a1: Tracking artifacts and quality runbooks (evidence: `progress/CAPTIONS_QUALITY_PARITY_PLAN.md`)
- [x] a2: Quality eval APIs and routing policy scaffolding (evidence: `app/api/quality/evals/run/route.ts`)
- [x] a3: CI promotion gate wiring (evidence: `docs/quality/QUALITY_GATES.md`)

### Track B - ASR + Captions Quality
- [x] b1: ASR orchestration replacement (evidence: `lib/ai/asr-quality.ts`)
- [x] b2: Alignment and segmentation quality passes (evidence: `docs/quality/EVAL_DATASETS.md`)

### Track C - Translation, Dubbing, Lip-Sync Quality
- [x] c1: Glossary-aware translation profiles (evidence: `app/api/workspace/translation-profiles/route.ts`)
- [x] c2: Lip-sync scorer and regenerate on fail (evidence: `lib/ai/phase5-quality.ts`)

### Track D - AI Edit and Chat Quality
- [x] d1: Planner-validator-executor pipeline (evidence: `lib/ai/chat-edit-pipeline.ts`)
- [x] d2: Timeline invariant validator before apply (evidence: `lib/timeline-invariants.ts`)
- [x] d3: Strict undo lineage checks and regressions (evidence: `app/api/projects/[id]/chat-edit/undo/route.ts`)

### Track E - Creator, Ads, Shorts Quality
- [x] e1: Multi-candidate generation and ranking (evidence: `lib/ai/phase4.ts`)
- [x] e2: Hook/pacing/readability quality scoring (evidence: `lib/ai/phase4-quality.ts`)
- [x] e3: Ads claim grounding checks (evidence: `app/api/ai-ads/generate/route.ts`)
- [x] e4: Shorts duplicate suppression and semantic ranking (evidence: `app/api/ai-shorts/generate/route.ts`)

### Track F - Mobile Top Workflow Parity
- [x] f1: Resumable uploads and network recovery (evidence: `app/api/mobile/uploads/resumable/initiate/route.ts`)
- [x] f2: Mobile telemetry ingestion and observability health summaries (evidence: `app/api/mobile/telemetry/route.ts`)
- [x] f3: Top workflow parity reporting and gap targets (evidence: `app/api/mobile/workflows/top/route.ts`)

### Track G - Commercial + Collaboration Hardening
- [x] g1: Credit preflight estimates and spend guardrails (evidence: `app/api/credits/preflight/route.ts`)
- [x] g2: Usage anomaly detection, status workflow, and alerts (evidence: `app/api/billing/anomalies/scan/route.ts`)
- [x] g3: Role matrix enforcement with immutable workspace audit trail (evidence: `app/api/workspace/audit/route.ts`)
- [x] g4: Subscription lifecycle reconciliation and integrity checks (evidence: `app/api/billing/reconcile/route.ts`)

## Risks And Mitigations

| Track ID | Risk ID | Severity | Mitigation |
| --- | --- | --- | --- |
| track_a_quality_eval_backbone | a_risk_vendor_drift | HIGH | Use routing policy fallbacks and canary rollouts before promotion |
| track_b_asr_captions_quality | b_risk_noisy_audio | MEDIUM | Add denoise pre-pass and confidence-triggered re-decode |
| track_c_translation_dubbing_lipsync | c_risk_multilingual_drift | HIGH | Per-language eval gates and calibrated provider routing |
| track_d_ai_edit_chat_quality | d_risk_non_deterministic_apply | MEDIUM | Block apply on invariant violations and fallback to constrained suggestions |
| track_e_creator_ads_shorts_quality | e_risk_hallucinated_claims | HIGH | Ground generated ad claims to extracted source facts and block unverifiable claims |
| track_f_mobile_top_workflow_parity | f_risk_mobile_network_churn | MEDIUM | Use resumable chunk uploads and offline-safe retry policies |
| track_g_commercial_collaboration_hardening | g_risk_credit_abuse | MEDIUM | Preflight credit estimates and automated anomaly alerting |

<!-- STATIC_APPENDIX_START -->
## Static Appendix

### Program Defaults
- Quality-first parity over feature-count parity.
- Web-first and mobile top workflows next.
- URL workflows remain rights-attested only.
<!-- STATIC_APPENDIX_END -->

Status legend: `[x]=DONE`, `[-]=IN_PROGRESS`, `[!]=BLOCKED`, `[ ]=TODO`
