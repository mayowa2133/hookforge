# HookForge Captions-Quality Parity Program

Owner: HookForge Core Team
Last updated: 2026-02-20T06:40:41.801Z

## Track Status

| Track ID | Title | Status | Deliverables | Risks |
| --- | --- | --- | --- | --- |
| track_a_quality_eval_backbone | Track A - Quality Evaluation Backbone | DONE | 3 | 1 |
| track_b_asr_captions_quality | Track B - ASR + Captions Quality | DONE | 2 | 1 |
| track_c_translation_dubbing_lipsync | Track C - Translation, Dubbing, Lip-Sync Quality | TODO | 2 | 1 |
| track_d_ai_edit_chat_quality | Track D - AI Edit and Chat Quality | TODO | 1 | 1 |
| track_e_creator_ads_shorts_quality | Track E - Creator, Ads, Shorts Quality | TODO | 1 | 1 |
| track_f_mobile_top_workflow_parity | Track F - Mobile Top Workflow Parity | TODO | 1 | 1 |
| track_g_commercial_collaboration_hardening | Track G - Commercial + Collaboration Hardening | IN PROGRESS | 1 | 1 |

## KPIs By Track

| Track ID | KPI | Current | Target | Unit |
| --- | --- | --- | --- | --- |
| track_a_quality_eval_backbone | Eval reproducibility coverage | 60 | 100 | % |
| track_a_quality_eval_backbone | Model promotion gate enforcement | 65 | 100 | % |
| track_b_asr_captions_quality | English WER | 7.8 | <= 8 | % |
| track_b_asr_captions_quality | Top-10 WER | 11.6 | <= 12 | % |
| track_b_asr_captions_quality | Caption timing median | 72 | <= 80 | ms |
| track_c_translation_dubbing_lipsync | Dubbing MOS | n/a | >= 4.2 | /5 |
| track_c_translation_dubbing_lipsync | Lip-sync drift median | n/a | <= 60 | ms |
| track_c_translation_dubbing_lipsync | Public translate API success | n/a | >= 98.5 | % |
| track_d_ai_edit_chat_quality | Valid plan success | n/a | >= 98 | % |
| track_d_ai_edit_chat_quality | Undo correctness | n/a | >= 99.5 | % |
| track_e_creator_ads_shorts_quality | In-product quality rating | n/a | >= 4.2 | /5 |
| track_e_creator_ads_shorts_quality | Ranked candidate uplift | n/a | > baseline | relative |
| track_f_mobile_top_workflow_parity | Crash-free sessions | n/a | >= 99.5 | % |
| track_f_mobile_top_workflow_parity | Top workflow completion vs web | n/a | within 10 | % gap |
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
- [ ] c1: Glossary-aware translation profiles (evidence: `docs/quality/QUALITY_GATES.md`)
- [ ] c2: Lip-sync scorer and regenerate on fail (evidence: `docs/quality/ROLLBACK_RUNBOOK.md`)

### Track D - AI Edit and Chat Quality
- [ ] d1: Planner-validator-executor pipeline (evidence: `lib/ai/chat-edit.ts`)

### Track E - Creator, Ads, Shorts Quality
- [ ] e1: Multi-candidate generation and ranking (evidence: `lib/ai/phase4.ts`)

### Track F - Mobile Top Workflow Parity
- [ ] f1: Resumable uploads and network recovery (evidence: `app/api/mobile/health/route.ts`)

### Track G - Commercial + Collaboration Hardening
- [-] g1: Usage anomaly schema and API scaffolding (evidence: `app/api/quality/metrics/route.ts`)

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
