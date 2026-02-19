#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_all_cookiejar_v3.txt"
EMAIL="e2e_all_$(date +%s)@example.com"
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
  local slug="$1"
  local title="$2"
  local payload
  payload=$(printf '{"templateSlug":"%s","title":"%s"}' "$slug" "$title")
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

enqueue_render() {
  local project_id="$1"
  local resp
  resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/projects/$project_id/render")
  echo "$resp" | jq -r ".renderJob.id"
}

wait_for_done() {
  local job_id="$1"
  local output_url=""
  for i in $(seq 1 180); do
    local resp
    resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/render-jobs/$job_id")
    local status
    status=$(echo "$resp" | jq -r ".renderJob.status")
    local progress
    progress=$(echo "$resp" | jq -r ".renderJob.progress")
    echo "job=$job_id poll=$i status=$status progress=$progress" >&2

    if [ "$status" = "DONE" ]; then
      output_url=$(echo "$resp" | jq -r ".renderJob.outputUrl")
      echo "$output_url"
      return 0
    fi

    if [ "$status" = "ERROR" ]; then
      echo "Render failed for job $job_id" >&2
      echo "$resp" | jq . >&2
      return 1
    fi

    sleep 2
  done

  return 1
}

verify_download() {
  local url="$1"
  local out_file="$2"
  local code
  code=$(curl -sS -o "$out_file" -w "%{http_code}" "$url")
  [ "$code" = "200" ]
  local bytes
  bytes=$(wc -c < "$out_file" | tr -d " ")
  [ "$bytes" -gt 1000 ]
  echo "$bytes"
}

register_user
echo "registered=$EMAIL"

TEMPLATES=(
  "green-screen-commentator"
  "tweet-comment-popup-reply"
  "three-beat-montage-intro-main-talk"
  "split-screen-reaction"
  "fake-facetime-incoming-call"
)

for slug in "${TEMPLATES[@]}"; do
  echo "=== TEMPLATE $slug ==="
  project_id=$(create_project "$slug" "E2E $slug")
  [ -n "$project_id" ] && [ "$project_id" != "null" ]
  echo "project=$project_id"

  case "$slug" in
    "green-screen-commentator")
      upload_slot "$project_id" "background" "public/demo-assets/pattern-grid.svg" "image/svg+xml" >/dev/null
      status=$(upload_slot "$project_id" "foreground" "public/demo-assets/demo-portrait.mp4" "video/mp4")
      ;;
    "tweet-comment-popup-reply")
      upload_slot "$project_id" "main" "public/demo-assets/demo-portrait.mp4" "video/mp4" >/dev/null
      status=$(upload_slot "$project_id" "overlay" "public/demo-assets/mock-comment.png" "image/png")
      ;;
    "three-beat-montage-intro-main-talk")
      upload_slot "$project_id" "montage_1" "public/demo-assets/pattern-grid.svg" "image/svg+xml" >/dev/null
      upload_slot "$project_id" "montage_2" "public/demo-assets/pattern-waves.svg" "image/svg+xml" >/dev/null
      upload_slot "$project_id" "montage_3" "public/demo-assets/pattern-steps.svg" "image/svg+xml" >/dev/null
      status=$(upload_slot "$project_id" "main" "public/demo-assets/demo-portrait.mp4" "video/mp4")
      ;;
    "split-screen-reaction")
      upload_slot "$project_id" "top" "public/demo-assets/demo-portrait.mp4" "video/mp4" >/dev/null
      status=$(upload_slot "$project_id" "bottom" "public/demo-assets/demo-landscape.mp4" "video/mp4")
      ;;
    "fake-facetime-incoming-call")
      upload_slot "$project_id" "caller_photo" "public/demo-assets/caller-avatar.svg" "image/svg+xml" >/dev/null
      status=$(upload_slot "$project_id" "main" "public/demo-assets/demo-portrait.mp4" "video/mp4")
      ;;
    *)
      echo "Unknown template: $slug" >&2
      exit 1
      ;;
  esac

  echo "status_after_assets=$status"
  [ "$status" = "READY" ]

  job_id=$(enqueue_render "$project_id")
  [ -n "$job_id" ] && [ "$job_id" != "null" ]
  echo "job=$job_id"

  output_url=$(wait_for_done "$job_id")
  [ -n "$output_url" ] && [ "$output_url" != "null" ]

  bytes=$(verify_download "$output_url" "/tmp/hookforge_${slug}.mp4")
  echo "template=$slug DONE bytes=$bytes"
done

echo "ALL_TEMPLATES_E2E_SUCCESS"
