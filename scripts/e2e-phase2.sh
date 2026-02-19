#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_phase2_cookiejar.txt"
EMAIL="e2e_phase2_$(date +%s)@example.com"
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

create_project() {
  local payload
  payload='{"templateSlug":"tweet-comment-popup-reply","title":"E2E Phase2"}'
  local resp
  resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
    -X POST "$BASE/api/projects" \
    -H "Content-Type: application/json" \
    -d "$payload")
  echo "$resp" | jq -r ".project.id"
}

upload_slot() {
  local project_id="$1"
  local slot_key="$2"
  local file_path="$3"
  local mime_type="$4"
  local filename
  filename=$(basename "$file_path")
  local size
  size=$(wc -c < "$file_path" | tr -d " ")

  local presign_payload
  presign_payload=$(printf '{"slotKey":"%s","fileName":"%s","mimeType":"%s","sizeBytes":%s}' \
    "$slot_key" "$filename" "$mime_type" "$size")
  local presign_resp
  presign_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
    -X POST "$BASE/api/projects/$project_id/assets/presign" \
    -H "Content-Type: application/json" \
    -d "$presign_payload")
  local upload_url
  upload_url=$(echo "$presign_resp" | jq -r ".uploadUrl")
  local storage_key
  storage_key=$(echo "$presign_resp" | jq -r ".storageKey")
  [ -n "$upload_url" ] && [ "$upload_url" != "null" ]

  curl -sS -X PUT "$upload_url" -H "Content-Type: $mime_type" --data-binary @"$file_path" >/dev/null

  local register_payload
  register_payload=$(printf '{"slotKey":"%s","storageKey":"%s","mimeType":"%s"}' \
    "$slot_key" "$storage_key" "$mime_type")
  local register_resp
  register_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
    -X POST "$BASE/api/projects/$project_id/assets/register" \
    -H "Content-Type: application/json" \
    -d "$register_payload")
  echo "$register_resp" | jq -r ".project.status"
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
  for i in $(seq 1 180); do
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

project_id=$(create_project)
[ -n "$project_id" ] && [ "$project_id" != "null" ]
echo "project=$project_id"

upload_slot "$project_id" "main" "public/demo-assets/demo-portrait.mp4" "video/mp4" >/dev/null
status=$(upload_slot "$project_id" "overlay" "public/demo-assets/mock-comment.png" "image/png")
[ "$status" = "READY" ]
echo "status_after_assets=$status"

auto_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects/$project_id/captions/auto" \
  -H "Content-Type: application/json" \
  -d '{"language":"en","diarization":false,"punctuationStyle":"auto"}')
auto_job_id=$(echo "$auto_resp" | jq -r ".aiJobId")
[ -n "$auto_job_id" ] && [ "$auto_job_id" != "null" ]
wait_for_ai_job "$auto_job_id"

captions_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects/$project_id/captions")
en_count=$(echo "$captions_resp" | jq -r '.byLanguage.en | length')
words_count=$(echo "$captions_resp" | jq -r '.transcriptWords | length')
[ "$en_count" -gt 0 ]
[ "$words_count" -gt 0 ]
echo "captions_en=$en_count transcript_words=$words_count"

translate_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects/$project_id/captions/translate" \
  -H "Content-Type: application/json" \
  -d '{"sourceLanguage":"en","targetLanguages":["es","fr"],"tone":"neutral"}')
translate_job_id=$(echo "$translate_resp" | jq -r ".translationJobId")
[ -n "$translate_job_id" ] && [ "$translate_job_id" != "null" ]
wait_for_ai_job "$translate_job_id"

captions_translated=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects/$project_id/captions")
es_count=$(echo "$captions_translated" | jq -r '.byLanguage.es | length')
fr_count=$(echo "$captions_translated" | jq -r '.byLanguage.fr | length')
[ "$es_count" -gt 0 ]
[ "$fr_count" -gt 0 ]
echo "captions_es=$es_count captions_fr=$fr_count"

ai_edit_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects/$project_id/ai-edit" \
  -H "Content-Type: application/json" \
  -d '{"styleId":"punchy","includeBroll":true,"includeMusic":true,"includeSfx":true}')
ai_edit_job_id=$(echo "$ai_edit_resp" | jq -r ".aiEditJobId")
[ -n "$ai_edit_job_id" ] && [ "$ai_edit_job_id" != "null" ]
wait_for_ai_job "$ai_edit_job_id"

chat_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects/$project_id/chat-edit" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"split the intro and make captions bolder"}')
chat_job_id=$(echo "$chat_resp" | jq -r ".aiJobId")
undo_token=$(echo "$chat_resp" | jq -r ".undoToken")
[ -n "$chat_job_id" ] && [ "$chat_job_id" != "null" ]
[ -n "$undo_token" ] && [ "$undo_token" != "null" ]
wait_for_ai_job "$chat_job_id"

undo_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects/$project_id/chat-edit/undo" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"undoToken":"%s"}' "$undo_token")")
restored=$(echo "$undo_resp" | jq -r ".restored")
[ "$restored" = "true" ]
echo "chat_undo_restored=$restored"

render_job_id=$(enqueue_render "$project_id")
[ -n "$render_job_id" ] && [ "$render_job_id" != "null" ]
output_url=$(wait_for_render_done "$render_job_id")
[ -n "$output_url" ] && [ "$output_url" != "null" ]

render_code=$(curl -sS -o /tmp/hookforge_phase2.mp4 -w "%{http_code}" "$output_url")
[ "$render_code" = "200" ]
render_bytes=$(wc -c < /tmp/hookforge_phase2.mp4 | tr -d " ")
[ "$render_bytes" -gt 1000 ]
echo "phase2_render_bytes=$render_bytes"

echo "PHASE2_E2E_SUCCESS"
