#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_trackab_cookiejar.txt"
EMAIL="e2e_trackab_$(date +%s)@example.com"
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

register_user
echo "registered=$EMAIL"

quality_eval_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/quality/evals/run" \
  -H "Content-Type: application/json" \
  -d '{"capability":"asr","trigger":"manual","metrics":{"successRate":98.9,"latencyP95Ms":1700,"werEnglish":7.2,"werTop10":11.1,"timingMedianMs":74,"timingP95Ms":162}}')

eval_run_id=$(echo "$quality_eval_resp" | jq -r '.evalRunId')
eval_passed=$(echo "$quality_eval_resp" | jq -r '.passed')
[ -n "$eval_run_id" ] && [ "$eval_run_id" != "null" ]
[ "$eval_passed" = "true" ]
echo "quality_eval_id=$eval_run_id passed=$eval_passed"

eval_status_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/quality/evals/$eval_run_id")
read_eval_id=$(echo "$eval_status_resp" | jq -r '.evalRun.id')
read_eval_status=$(echo "$eval_status_resp" | jq -r '.evalRun.status')
[ "$read_eval_id" = "$eval_run_id" ]
[ "$read_eval_status" = "DONE" ]

eval_metrics_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/quality/metrics")
latest_capability=$(echo "$eval_metrics_resp" | jq -r '.latestByCapability[0].capability')
[ -n "$latest_capability" ] && [ "$latest_capability" != "null" ]
echo "quality_latest_capability=$latest_capability"

route_policy_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/models/route-policy")
policy_count=$(echo "$route_policy_resp" | jq -r '.policies | length')
[ "$policy_count" -gt 0 ]
echo "route_policies=$policy_count"

route_policy_upsert=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/models/route-policy" \
  -H "Content-Type: application/json" \
  -d '{"capability":"asr","rolloutPercent":100,"enforceQualityGate":false}')
updated_capability=$(echo "$route_policy_upsert" | jq -r '.policy.capability')
[ "$updated_capability" = "asr" ]

feedback_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/quality/feedback" \
  -H "Content-Type: application/json" \
  -d '{"category":"caption_quality","rating":5,"comment":"Track A/B validation"}')
feedback_id=$(echo "$feedback_resp" | jq -r '.feedback.id')
[ -n "$feedback_id" ] && [ "$feedback_id" != "null" ]
echo "feedback_id=$feedback_id"

api_key_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/public-api-keys" \
  -H "Content-Type: application/json" \
  -d '{"name":"TrackAB E2E Key"}')
public_key=$(echo "$api_key_resp" | jq -r '.secret')
[ -n "$public_key" ] && [ "$public_key" != "null" ]

translate_estimate_resp=$(curl -sS \
  -X POST "$BASE/api/public/v1/translate/estimate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $public_key" \
  -d '{"sourceLanguage":"en","targetLanguages":["es","fr"],"lipDub":false,"durationSec":75}')
estimated_credits=$(echo "$translate_estimate_resp" | jq -r '.estimate.credits')
[ "$estimated_credits" -gt 0 ]
echo "translate_estimate_credits=$estimated_credits"

mobile_health_resp=$(curl -sS "$BASE/api/mobile/health")
mobile_health_ok=$(echo "$mobile_health_resp" | jq -r '.ok')
[ "$mobile_health_ok" = "true" ]

echo "TRACK_AB_E2E_SUCCESS"
