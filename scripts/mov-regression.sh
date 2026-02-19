#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/mayowaadesanya/Documents/Projects/hookforge"
COREPACK_HOME="$ROOT/.corepack"

cd "$ROOT"

docker-compose up -d >/tmp/mov_fix_compose.log 2>&1 || true
ffmpeg -y -i public/demo-assets/demo-portrait.mp4 -c copy /tmp/hookforge-test-input.MOV >/dev/null 2>&1

PORT=3121 COREPACK_HOME="$COREPACK_HOME" corepack pnpm dev > /tmp/mov_fix_dev.log 2>&1 &
DEV_PID=$!
COREPACK_HOME="$COREPACK_HOME" corepack pnpm worker > /tmp/mov_fix_worker.log 2>&1 &
WORKER_PID=$!

cleanup() {
  kill "$DEV_PID" >/dev/null 2>&1 || true
  kill "$WORKER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for i in $(seq 1 120); do
  if curl -sS -o /dev/null http://localhost:3121; then
    break
  fi
  sleep 1
  if [ "$i" -eq 120 ]; then
    echo "SERVER_NOT_READY"
    tail -n 200 /tmp/mov_fix_dev.log || true
    tail -n 200 /tmp/mov_fix_worker.log || true
    exit 1
  fi
done

BASE="http://localhost:3121"
COOKIE="/tmp/mov_fix_cookie.txt"
EMAIL="movfix_$(date +%s)@example.com"
PASSWORD="StrongPass123!"
rm -f "$COOKIE"

REGISTER_PAYLOAD=$(jq -n --arg email "$EMAIL" --arg password "$PASSWORD" '{email:$email,password:$password}')
REGISTER_RESP=$(curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" -d "$REGISTER_PAYLOAD")
echo "$REGISTER_RESP" | jq . >/dev/null

CREATE_PAYLOAD='{"templateSlug":"green-screen-commentator","title":"MOV fix check"}'
CREATE_RESP=$(curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/projects" -H "Content-Type: application/json" -d "$CREATE_PAYLOAD")
PROJECT_ID=$(echo "$CREATE_RESP" | jq -r '.project.id')
[ -n "$PROJECT_ID" ] && [ "$PROJECT_ID" != "null" ]

upload_slot() {
  local slot_key="$1"
  local file_path="$2"
  local mime_type="$3"
  local file_name
  file_name=$(basename "$file_path")
  local size
  size=$(wc -c < "$file_path" | tr -d " ")

  local presign_payload
  presign_payload=$(jq -n --arg slotKey "$slot_key" --arg fileName "$file_name" --arg mimeType "$mime_type" --argjson sizeBytes "$size" '{slotKey:$slotKey,fileName:$fileName,mimeType:$mimeType,sizeBytes:$sizeBytes}')
  local presign_resp
  presign_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/projects/$PROJECT_ID/assets/presign" -H "Content-Type: application/json" -d "$presign_payload")
  local upload_url
  upload_url=$(echo "$presign_resp" | jq -r '.uploadUrl')
  local storage_key
  storage_key=$(echo "$presign_resp" | jq -r '.storageKey')

  curl -sS -X PUT "$upload_url" -H "Content-Type: $mime_type" --data-binary @"$file_path" >/dev/null

  local register_payload
  register_payload=$(jq -n --arg slotKey "$slot_key" --arg storageKey "$storage_key" --arg mimeType "$mime_type" '{slotKey:$slotKey,storageKey:$storageKey,mimeType:$mimeType}')
  curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/projects/$PROJECT_ID/assets/register" -H "Content-Type: application/json" -d "$register_payload"
}

upload_slot background public/demo-assets/pattern-grid.svg image/svg+xml >/dev/null
REGISTER_MOV_RESP=$(upload_slot foreground /tmp/hookforge-test-input.MOV video/quicktime)
STATUS=$(echo "$REGISTER_MOV_RESP" | jq -r '.project.status')
MIME=$(echo "$REGISTER_MOV_RESP" | jq -r '.asset.mimeType')

echo "REGISTER_STATUS=$STATUS"
echo "REGISTERED_MIME=$MIME"

[ "$STATUS" = "READY" ]
[ "$MIME" = "video/mp4" ]

RENDER_RESP=$(curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/projects/$PROJECT_ID/render")
JOB_ID=$(echo "$RENDER_RESP" | jq -r '.renderJob.id')

for i in $(seq 1 120); do
  JOB_RESP=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/render-jobs/$JOB_ID")
  JOB_STATUS=$(echo "$JOB_RESP" | jq -r '.renderJob.status')
  JOB_PROGRESS=$(echo "$JOB_RESP" | jq -r '.renderJob.progress')
  echo "poll=$i status=$JOB_STATUS progress=$JOB_PROGRESS"

  if [ "$JOB_STATUS" = "DONE" ]; then
    OUTPUT_URL=$(echo "$JOB_RESP" | jq -r '.renderJob.outputUrl')
    CODE=$(curl -sS -o /tmp/mov_fix_output.mp4 -w "%{http_code}" "$OUTPUT_URL")
    [ "$CODE" = "200" ]
    BYTES=$(wc -c < /tmp/mov_fix_output.mp4 | tr -d " ")
    echo "MOV_RENDER_SUCCESS bytes=$BYTES"
    exit 0
  fi

  if [ "$JOB_STATUS" = "ERROR" ]; then
    echo "$JOB_RESP" | jq .
    echo "--- worker log ---"
    tail -n 200 /tmp/mov_fix_worker.log || true
    exit 1
  fi

  sleep 2
done

echo "MOV_RENDER_TIMEOUT"
exit 1
