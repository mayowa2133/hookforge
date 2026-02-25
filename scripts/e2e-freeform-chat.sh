#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_freeform_cookie.txt"
EMAIL="e2e_freeform_$(date +%s)@example.com"
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
  for i in $(seq 1 120); do
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
    if [ "$status" = "ERROR" ] || [ "$status" = "CANCELED" ]; then
      echo "$resp" | jq . >&2
      return 1
    fi
    sleep 2
  done
  return 1
}

wait_for_render_done() {
  local job_id="$1"
  for i in $(seq 1 180); do
    local resp
    resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/render-jobs/$job_id")
    local status
    status=$(echo "$resp" | jq -r ".renderJob.status")
    local progress
    progress=$(echo "$resp" | jq -r ".renderJob.progress")
    echo "render_job=$job_id poll=$i status=$status progress=$progress" >&2
    if [ "$status" = "DONE" ]; then
      echo "$resp" | jq -r ".renderJob.outputUrl"
      return 0
    fi
    if [ "$status" = "ERROR" ]; then
      echo "$resp" | jq . >&2
      return 1
    fi
    sleep 2
  done
  return 1
}

register_user
echo "registered=$EMAIL"

create_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2" \
  -H "Content-Type: application/json" \
  -d '{"mode":"FREEFORM","title":"E2E Freeform Chat"}')
project_id=$(echo "$create_resp" | jq -r ".project.id")
legacy_bridge=$(echo "$create_resp" | jq -r ".project.legacyProjectId")
[ -n "$project_id" ] && [ "$project_id" != "null" ]
[ -n "$legacy_bridge" ] && [ "$legacy_bridge" != "null" ]
echo "project_v2=$project_id legacy_bridge=$legacy_bridge"

import_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/media/import" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"demo-portrait.mp4","mimeType":"video/mp4","sizeBytes":123456,"slot":"primary"}')
upload_url=$(echo "$import_resp" | jq -r ".uploadUrl")
storage_key=$(echo "$import_resp" | jq -r ".storageKey")
[ -n "$upload_url" ] && [ "$upload_url" != "null" ]
[ -n "$storage_key" ] && [ "$storage_key" != "null" ]

curl -sS -X PUT "$upload_url" -H "Content-Type: video/mp4" --data-binary @public/demo-assets/demo-portrait.mp4 >/dev/null

register_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/media/register" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"storageKey":"%s","mimeType":"video/mp4","originalFileName":"demo-portrait.mp4","slot":"primary"}' "$storage_key")")
project_status=$(echo "$register_resp" | jq -r ".project.status")
[ "$project_status" = "READY" ]
echo "project_status_after_upload=$project_status"

auto_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/transcript/auto" \
  -H "Content-Type: application/json" \
  -d '{"language":"en","diarization":false,"punctuationStyle":"auto","confidenceThreshold":0.86,"reDecodeEnabled":true,"maxWordsPerSegment":7,"maxCharsPerLine":24,"maxLinesPerSegment":2}')
auto_job_id=$(echo "$auto_resp" | jq -r ".aiJobId")
[ -n "$auto_job_id" ] && [ "$auto_job_id" != "null" ]
wait_for_ai_job "$auto_job_id"

plan_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/chat/plan" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"split the first clip at midpoint and tighten intro pacing"}')
plan_id=$(echo "$plan_resp" | jq -r ".planId")
plan_mode=$(echo "$plan_resp" | jq -r ".executionMode")
[ -n "$plan_id" ] && [ "$plan_id" != "null" ]
echo "plan_mode=$plan_mode"

apply_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/chat/apply" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"planId":"%s","confirmed":true}' "$plan_id")")
applied=$(echo "$apply_resp" | jq -r ".applied")
undo_token=$(echo "$apply_resp" | jq -r ".undoToken")
[ "$applied" = "true" ]
[ -n "$undo_token" ] && [ "$undo_token" != "null" ]
echo "chat_apply_applied=$applied"

undo_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/chat/undo" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"undoToken":"%s"}' "$undo_token")")
restored=$(echo "$undo_resp" | jq -r ".restored")
[ "$restored" = "true" ]
echo "chat_undo_restored=$restored"

render_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/render/final")
render_job_id=$(echo "$render_resp" | jq -r ".renderJob.id")
[ -n "$render_job_id" ] && [ "$render_job_id" != "null" ]

output_url=$(wait_for_render_done "$render_job_id")
[ -n "$output_url" ] && [ "$output_url" != "null" ]
render_code=$(curl -sS -o /tmp/hookforge_freeform.mp4 -w "%{http_code}" "$output_url")
[ "$render_code" = "200" ]
render_bytes=$(wc -c < /tmp/hookforge_freeform.mp4 | tr -d " ")
[ "$render_bytes" -gt 1000 ]
echo "freeform_render_bytes=$render_bytes"

echo "FREEFORM_E2E_SUCCESS"
