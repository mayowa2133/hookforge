#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_phase4_cookiejar.txt"
EMAIL="e2e_phase4_$(date +%s)@example.com"
PASSWORD="StrongPass123!"

rm -f "$COOKIE"

register_user() {
  local payload
  payload=$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")
  curl -sS -c "$COOKIE" -b "$COOKIE" \
    -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null
}

wait_for_ai_job() {
  local job_id="$1"
  for i in $(seq 1 140); do
    local resp
    resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/ai-jobs/$job_id")
    local status
    status=$(echo "$resp" | jq -r ".aiJob.status")
    local progress
    progress=$(echo "$resp" | jq -r ".aiJob.progress")
    echo "ai_job=$job_id poll=$i status=$status progress=$progress" >&2

    if [ "$status" = "DONE" ]; then
      return 0
    fi
    if [ "$status" = "ERROR" ]; then
      echo "AI job failed: $job_id" >&2
      echo "$resp" | jq . >&2
      return 1
    fi

    sleep 2
  done

  return 1
}

enqueue_render() {
  local project_id="$1"
  local resp
  resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/projects/$project_id/render")
  echo "$resp" | jq -r ".renderJob.id"
}

wait_for_render_done() {
  local job_id="$1"
  local output_url=""

  for i in $(seq 1 220); do
    local resp
    resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/render-jobs/$job_id")
    local status
    status=$(echo "$resp" | jq -r ".renderJob.status")
    local progress
    progress=$(echo "$resp" | jq -r ".renderJob.progress")
    echo "render_job=$job_id poll=$i status=$status progress=$progress" >&2

    if [ "$status" = "DONE" ]; then
      output_url=$(echo "$resp" | jq -r ".renderJob.outputUrl")
      echo "$output_url"
      return 0
    fi

    if [ "$status" = "ERROR" ]; then
      echo "Render failed: $job_id" >&2
      echo "$resp" | jq . >&2
      return 1
    fi

    sleep 2
  done

  return 1
}

register_user
echo "registered=$EMAIL"

# AI Ads flow
ads_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/ai-ads/generate" \
  -H "Content-Type: application/json" \
  -d '{"websiteUrl":"https://example.com/pricing","productName":"HookForge","tone":"ugc","durationSec":30,"rightsAttested":true,"statement":"I own rights to use this website content for structural ad generation and review."}')

ads_job_id=$(echo "$ads_resp" | jq -r ".aiJobId")
ads_project_id=$(echo "$ads_resp" | jq -r ".legacyProjectId")
ads_preflight_rating=$(echo "$ads_resp" | jq -r ".qualitySummary.ratingScore")
ads_preflight_uplift=$(echo "$ads_resp" | jq -r ".qualitySummary.candidateUpliftPct")
ads_preflight_candidates=$(echo "$ads_resp" | jq -r ".rankedCandidates | length")
[ -n "$ads_job_id" ] && [ "$ads_job_id" != "null" ]
[ -n "$ads_project_id" ] && [ "$ads_project_id" != "null" ]
[ "$ads_preflight_candidates" -gt 1 ]
awk "BEGIN {exit !($ads_preflight_rating >= 4.2)}"
awk "BEGIN {exit !($ads_preflight_uplift > 0)}"
wait_for_ai_job "$ads_job_id"

echo "ads_project=$ads_project_id"

ads_job_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/ai-jobs/$ads_job_id")
ads_rating=$(echo "$ads_job_resp" | jq -r ".aiJob.output.sideEffects.phase4.qualitySummary.ratingScore")
ads_uplift=$(echo "$ads_job_resp" | jq -r ".aiJob.output.sideEffects.phase4.qualitySummary.candidateUpliftPct")
ads_grounding=$(echo "$ads_job_resp" | jq -r ".aiJob.output.sideEffects.phase4.claimGrounding.passed")
awk "BEGIN {exit !($ads_rating >= 4.2)}"
awk "BEGIN {exit !($ads_uplift > 0)}"
[ "$ads_grounding" = "true" ]
echo "ads_quality_rating=$ads_rating uplift=$ads_uplift grounding=$ads_grounding"

ads_project_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects/$ads_project_id")
ads_status=$(echo "$ads_project_resp" | jq -r ".project.status")
[ "$ads_status" = "READY" ]

ads_render_job=$(enqueue_render "$ads_project_id")
[ -n "$ads_render_job" ] && [ "$ads_render_job" != "null" ]
ads_render_url=$(wait_for_render_done "$ads_render_job")
[ -n "$ads_render_url" ] && [ "$ads_render_url" != "null" ]
ads_render_code=$(curl -sS -o /tmp/hookforge_phase4_ads.mp4 -w "%{http_code}" "$ads_render_url")
[ "$ads_render_code" = "200" ]
ads_render_bytes=$(wc -c < /tmp/hookforge_phase4_ads.mp4 | tr -d " ")
[ "$ads_render_bytes" -gt 1000 ]
echo "ads_render_bytes=$ads_render_bytes"

# AI Shorts flow
shorts_source_url="https://www.youtube.com/watch?v=abc123xyz"
shorts_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/ai-shorts/generate" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"sourceUrl":"%s","clipCount":2,"language":"en","sourceDurationSec":240,"rightsAttested":true,"statement":"I own rights to process this source URL into structural short drafts."}' "$shorts_source_url")")

shorts_job_id=$(echo "$shorts_resp" | jq -r ".aiJobId")
[ -n "$shorts_job_id" ] && [ "$shorts_job_id" != "null" ]
wait_for_ai_job "$shorts_job_id"

shorts_job_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/ai-jobs/$shorts_job_id")
shorts_project_id=$(echo "$shorts_job_resp" | jq -r ".aiJob.output.sideEffects.phase4.editableProjects[0].legacyProjectId")
shorts_rating=$(echo "$shorts_job_resp" | jq -r ".aiJob.output.sideEffects.phase4.qualitySummary.ratingScore")
shorts_uplift=$(echo "$shorts_job_resp" | jq -r ".aiJob.output.sideEffects.phase4.qualitySummary.candidateUpliftPct")
shorts_duplicates=$(echo "$shorts_job_resp" | jq -r ".aiJob.output.sideEffects.phase4.duplicatesSuppressed")
[ -n "$shorts_project_id" ] && [ "$shorts_project_id" != "null" ]
awk "BEGIN {exit !($shorts_rating >= 4.2)}"
awk "BEGIN {exit !($shorts_uplift > 0)}"
[ "$shorts_duplicates" -ge 0 ]
echo "shorts_project=$shorts_project_id"
echo "shorts_quality_rating=$shorts_rating uplift=$shorts_uplift duplicates=$shorts_duplicates"

shorts_render_job=$(enqueue_render "$shorts_project_id")
[ -n "$shorts_render_job" ] && [ "$shorts_render_job" != "null" ]
shorts_render_url=$(wait_for_render_done "$shorts_render_job")
[ -n "$shorts_render_url" ] && [ "$shorts_render_url" != "null" ]
shorts_render_code=$(curl -sS -o /tmp/hookforge_phase4_shorts.mp4 -w "%{http_code}" "$shorts_render_url")
[ "$shorts_render_code" = "200" ]
shorts_render_bytes=$(wc -c < /tmp/hookforge_phase4_shorts.mp4 | tr -d " ")
[ "$shorts_render_bytes" -gt 1000 ]
echo "shorts_render_bytes=$shorts_render_bytes"

# Reddit-to-video flow
reddit_source_url="https://www.reddit.com/r/startups/comments/abc123/how_to_launch/"
reddit_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/reddit-to-video/generate" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"redditUrl":"%s","postTitle":"How to launch","postBody":"What worked for you?","clipCount":2,"language":"en","rightsAttested":true,"statement":"I own rights to transform this Reddit thread context into new video structure."}' "$reddit_source_url")")

reddit_job_id=$(echo "$reddit_resp" | jq -r ".aiJobId")
reddit_subreddit=$(echo "$reddit_resp" | jq -r ".context.subreddit")
[ -n "$reddit_job_id" ] && [ "$reddit_job_id" != "null" ]
[ "$reddit_subreddit" = "startups" ]
wait_for_ai_job "$reddit_job_id"

reddit_job_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/ai-jobs/$reddit_job_id")
reddit_project_id=$(echo "$reddit_job_resp" | jq -r ".aiJob.output.sideEffects.phase4.editableProjects[0].legacyProjectId")
reddit_rating=$(echo "$reddit_job_resp" | jq -r ".aiJob.output.sideEffects.phase4.qualitySummary.ratingScore")
reddit_uplift=$(echo "$reddit_job_resp" | jq -r ".aiJob.output.sideEffects.phase4.qualitySummary.candidateUpliftPct")
[ -n "$reddit_project_id" ] && [ "$reddit_project_id" != "null" ]
awk "BEGIN {exit !($reddit_rating >= 4.2)}"
awk "BEGIN {exit !($reddit_uplift > 0)}"
echo "reddit_project=$reddit_project_id"
echo "reddit_quality_rating=$reddit_rating uplift=$reddit_uplift"

# Compliance audit + takedown

audit_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/compliance/audit")
attestation_count=$(echo "$audit_resp" | jq -r ".summary.rightsAttestationCount")
[ "$attestation_count" -ge 3 ]
echo "attestations=$attestation_count"

takedown_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/compliance/takedown" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"sourceUrl":"%s","reason":"Rights owner requested source deactivation."}' "$shorts_source_url")")

affected_links=$(echo "$takedown_resp" | jq -r ".affectedLinks")
[ "$affected_links" -ge 1 ]
echo "takedown_affected_links=$affected_links"

post_audit_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/compliance/audit")
takedown_count=$(echo "$post_audit_resp" | jq -r ".summary.takedownCount")
[ "$takedown_count" -ge 1 ]
echo "takedown_count=$takedown_count"

echo "PHASE4_E2E_SUCCESS"
