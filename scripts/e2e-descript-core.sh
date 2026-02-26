#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_descript_core_cookie.txt"
EMAIL="e2e_descript_core_$(date +%s)@example.com"
PASSWORD="StrongPass123!"
UPLOAD_HEADERS="/tmp/hookforge_descript_recording_headers.txt"
OUTPUT_MP4="/tmp/hookforge_descript_core.mp4"
SOURCE_FILE="public/demo-assets/demo-portrait.mp4"

rm -f "$COOKIE" "$UPLOAD_HEADERS" "$OUTPUT_MP4"

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
  for i in $(seq 1 180); do
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
  for i in $(seq 1 240); do
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
  -d '{"mode":"FREEFORM","title":"E2E Descript Core"}')
project_id=$(echo "$create_resp" | jq -r ".project.id")
[ -n "$project_id" ] && [ "$project_id" != "null" ]
echo "project_v2=$project_id"

size_bytes=$(wc -c < "$SOURCE_FILE" | tr -d " ")
start_recording=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/recordings/session" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"mode":"SCREEN_CAMERA","fileName":"demo-portrait.mp4","mimeType":"video/mp4","sizeBytes":%s,"totalParts":1,"partSizeBytes":8388608,"autoTranscribe":true,"language":"en"}' "$size_bytes")")
recording_session_id=$(echo "$start_recording" | jq -r ".session.id")
[ -n "$recording_session_id" ] && [ "$recording_session_id" != "null" ]
echo "recording_session=$recording_session_id"

chunk_url_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/recordings/session/$recording_session_id/chunk" \
  -H "Content-Type: application/json" \
  -d '{"partNumber":1}')
chunk_upload_url=$(echo "$chunk_url_resp" | jq -r ".uploadUrl")
[ -n "$chunk_upload_url" ] && [ "$chunk_upload_url" != "null" ]

curl -sS -D "$UPLOAD_HEADERS" -o /dev/null \
  -X PUT "$chunk_upload_url" \
  -H "Content-Type: video/mp4" \
  --data-binary @"$SOURCE_FILE"

etag=$(awk 'tolower($1) == "etag:" {print $2}' "$UPLOAD_HEADERS" | tail -n 1 | tr -d '\r"')
[ -n "$etag" ]
checksum=$(shasum -a 256 "$SOURCE_FILE" | awk '{print $1}')

chunk_confirm_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/recordings/session/$recording_session_id/chunk" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"partNumber":1,"eTag":"%s","checksumSha256":"%s"}' "$etag" "$checksum")")
confirm_mode=$(echo "$chunk_confirm_resp" | jq -r ".mode")
[ "$confirm_mode" = "CHUNK_CONFIRMED" ]

finalize_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/recordings/session/$recording_session_id/finalize" \
  -H "Content-Type: application/json" \
  -d '{"autoTranscribe":true,"language":"en"}')
finalized=$(echo "$finalize_resp" | jq -r ".finalized")
final_status=$(echo "$finalize_resp" | jq -r ".status")
transcript_job=$(echo "$finalize_resp" | jq -r ".aiJobId")
[ "$finalized" = "true" ]
[ "$final_status" = "COMPLETED" ]
[ -n "$transcript_job" ] && [ "$transcript_job" != "null" ]
wait_for_ai_job "$transcript_job"

transcript_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/transcript?language=en")
segment_count=$(echo "$transcript_resp" | jq -r '.segments | length')
word_count=$(echo "$transcript_resp" | jq -r '.words | length')
[ "$segment_count" -gt 0 ]
[ "$word_count" -gt 0 ]
echo "transcript_segments=$segment_count transcript_words=$word_count"

chat_plan_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/chat/plan" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"split first clip and tighten intro pacing"}')
plan_id=$(echo "$chat_plan_resp" | jq -r ".planId")
plan_hash=$(echo "$chat_plan_resp" | jq -r ".planRevisionHash")
[ -n "$plan_id" ] && [ "$plan_id" != "null" ]
[ -n "$plan_hash" ] && [ "$plan_hash" != "null" ]

chat_apply_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/chat/apply" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"planId":"%s","planRevisionHash":"%s","confirmed":true}' "$plan_id" "$plan_hash")")
undo_token=$(echo "$chat_apply_resp" | jq -r ".undoToken")
applied=$(echo "$chat_apply_resp" | jq -r ".applied")
[ "$applied" = "true" ]
[ -n "$undo_token" ] && [ "$undo_token" != "null" ]

chat_undo_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/chat/undo" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"undoToken":"%s"}' "$undo_token")")
restored=$(echo "$chat_undo_resp" | jq -r ".restored")
[ "$restored" = "true" ]

render_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/render/final")
render_job_id=$(echo "$render_resp" | jq -r ".renderJob.id")
[ -n "$render_job_id" ] && [ "$render_job_id" != "null" ]

output_url=$(wait_for_render_done "$render_job_id")
[ -n "$output_url" ] && [ "$output_url" != "null" ]
render_code=$(curl -sS -o "$OUTPUT_MP4" -w "%{http_code}" "$output_url")
[ "$render_code" = "200" ]
render_bytes=$(wc -c < "$OUTPUT_MP4" | tr -d " ")
[ "$render_bytes" -gt 1000 ]
echo "descript_core_render_bytes=$render_bytes"

echo "DESCRIPT_CORE_E2E_SUCCESS"
