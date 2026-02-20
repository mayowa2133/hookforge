# HookForge Evaluation Datasets

This document tracks evaluation corpus design for quality parity.

## Dataset Families

1. `asr_en_core_v1`
- 12h English creator speech
- Mixed noise environments
- Human transcript references with word timings

2. `asr_top10_v1`
- 2h per launch language (es, fr, de, it, pt, ja, ko, hi, ar, en)
- Balanced male/female/neutral speakers
- Accent coverage targets per language

3. `caption_timing_v1`
- 500 short-form clips with frame-accurate subtitle references
- Measures segment cuts, line wrapping, and reading speed violations

4. `dubbing_lipsync_v1`
- 300 single-speaker clips with phoneme alignment references
- Includes expressive speaking and fast speech edge-cases

5. `ai_edit_chat_v1`
- 1,000 prompts with expected operation plans + timeline invariants
- Includes malicious/ambiguous prompts for fallback checks

6. `creator_ads_shorts_v1`
- 400 source assets and prompts with rubric labels
- Hook strength, pacing, readability, claims-grounding labels

## Labeling Standards

1. Dual-rater mandatory for transcript and timing labels
2. Arbitration required when confidence delta > 0.2
3. MOS panels require minimum 20 raters per language batch

## Storage And Versioning

1. Store metadata references in Postgres and artifacts in object storage
2. Immutable dataset version ids (no in-place mutation)
3. Audit trail required for additions/removals

## Privacy And Consent

1. Only use opt-in cohort data for training/eval expansion
2. Remove all disallowed data within SLA from takedown request timestamp
3. Keep consent logs linked to dataset source records
