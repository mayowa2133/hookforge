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
  -X POST "$BASE/api/projects/$project_id/transcript/auto" \
  -H "Content-Type: application/json" \
  -d '{"language":"en","diarization":false,"punctuationStyle":"auto","confidenceThreshold":0.86,"reDecodeEnabled":true,"maxWordsPerSegment":7,"maxCharsPerLine":24,"maxLinesPerSegment":2}')
auto_job_id=$(echo "$auto_resp" | jq -r ".aiJobId")
[ -n "$auto_job_id" ] && [ "$auto_job_id" != "null" ]
wait_for_ai_job "$auto_job_id"

transcript_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects/$project_id/transcript?language=en")
segment_count=$(echo "$transcript_resp" | jq -r '.segments | length')
words_count=$(echo "$transcript_resp" | jq -r '.words | length')
[ "$segment_count" -gt 0 ]
[ "$words_count" -gt 0 ]
echo "transcript_segments=$segment_count transcript_words=$words_count"

first_segment_id=$(echo "$transcript_resp" | jq -r '.segments[0].id')
first_segment_start=$(echo "$transcript_resp" | jq -r '.segments[0].startMs')
first_segment_end=$(echo "$transcript_resp" | jq -r '.segments[0].endMs')
[ -n "$first_segment_id" ] && [ "$first_segment_id" != "null" ]

split_ms=$(( first_segment_start + ((first_segment_end-first_segment_start)/2) ))
if [ "$split_ms" -le "$first_segment_start" ]; then
  split_ms=$((first_segment_start + 120))
fi

patch_replace_split=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X PATCH "$BASE/api/projects/$project_id/transcript" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"language":"en","operations":[{"op":"replace_text","segmentId":"%s","text":"This is a tighter hook statement."},{"op":"split_segment","segmentId":"%s","splitMs":%s},{"op":"normalize_punctuation"}],"minConfidenceForRipple":0.86}' "$first_segment_id" "$first_segment_id" "$split_ms")")
patch_replace_applied=$(echo "$patch_replace_split" | jq -r ".applied")
[ "$patch_replace_applied" = "true" ]

transcript_after_patch=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects/$project_id/transcript?language=en")
updated_segment_count=$(echo "$transcript_after_patch" | jq -r '.segments | length')
[ "$updated_segment_count" -ge "$segment_count" ]

delete_start=$(echo "$transcript_after_patch" | jq -r '.segments[0].startMs')
delete_end=$(echo "$transcript_after_patch" | jq -r '.segments[0].endMs')
safe_delete_end=$((delete_start + 200))
if [ "$safe_delete_end" -ge "$delete_end" ]; then
  safe_delete_end=$((delete_start + 100))
fi

fallback_patch=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X PATCH "$BASE/api/projects/$project_id/transcript" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"language":"en","operations":[{"op":"delete_range","startMs":%s,"endMs":%s}],"minConfidenceForRipple":0.99}' "$delete_start" "$safe_delete_end")")
fallback_suggestions=$(echo "$fallback_patch" | jq -r ".suggestionsOnly")
[ "$fallback_suggestions" = "true" ]
echo "transcript_delete_fallback=$fallback_suggestions"

delete_patch=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X PATCH "$BASE/api/projects/$project_id/transcript" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"language":"en","operations":[{"op":"delete_range","startMs":%s,"endMs":%s}],"minConfidenceForRipple":0.86}' "$delete_start" "$safe_delete_end")")
delete_applied=$(echo "$delete_patch" | jq -r ".applied")
[ "$delete_applied" = "true" ]

captions_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects/$project_id/captions")
en_count=$(echo "$captions_resp" | jq -r '.byLanguage.en | length')
[ "$en_count" -gt 0 ]
echo "captions_en=$en_count"

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
chat_mode=$(echo "$chat_resp" | jq -r ".executionMode")
chat_plan_valid=$(echo "$chat_resp" | jq -r ".planValidation.isValid")
[ -n "$chat_job_id" ] && [ "$chat_job_id" != "null" ]
[ -n "$undo_token" ] && [ "$undo_token" != "null" ]
[ "$chat_mode" = "APPLIED" ]
[ "$chat_plan_valid" = "true" ]
wait_for_ai_job "$chat_job_id"

undo_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects/$project_id/chat-edit/undo" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"undoToken":"%s"}' "$undo_token")")
restored=$(echo "$undo_resp" | jq -r ".restored")
[ "$restored" = "true" ]
echo "chat_undo_restored=$restored"

fallback_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects/$project_id/chat-edit" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"make this magical and awesome vibes"}')
fallback_job_id=$(echo "$fallback_resp" | jq -r ".aiJobId")
fallback_mode=$(echo "$fallback_resp" | jq -r ".executionMode")
fallback_suggestions=$(echo "$fallback_resp" | jq -r ".constrainedSuggestions | length")
fallback_undo=$(echo "$fallback_resp" | jq -r ".undoToken")
[ -n "$fallback_job_id" ] && [ "$fallback_job_id" != "null" ]
[ "$fallback_mode" = "SUGGESTIONS_ONLY" ]
[ "$fallback_suggestions" -gt 0 ]
[ "$fallback_undo" = "null" ]
wait_for_ai_job "$fallback_job_id"
echo "chat_fallback_mode=$fallback_mode suggestions=$fallback_suggestions"

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
