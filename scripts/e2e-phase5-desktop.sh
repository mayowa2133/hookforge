#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_phase5_desktop_cookiejar.txt"
EMAIL="e2e_phase5_desktop_$(date +%s)@example.com"
PASSWORD="StrongPass123!"

rm -f "$COOKIE"

payload=$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")
curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" -d "$payload" >/dev/null

echo "registered=$EMAIL"

project_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/projects-v2" -H "Content-Type: application/json" -d '{"title":"Phase5 Desktop E2E"}')
project_id=$(echo "$project_resp" | jq -r '.project.id')
[ -n "$project_id" ] && [ "$project_id" != "null" ]

config_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/desktop/config")
config_supported=$(echo "$config_resp" | jq -r '.desktop.supported')
[ "$config_supported" = "true" ]

# Use an older client version to assert that a stable update is offered.
release_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/desktop/releases?platform=darwin-arm64&channel=stable&currentVersion=0.9.0")
update_available=$(echo "$release_resp" | jq -r '.updateAvailable')
[ "$update_available" = "true" ]

ingest_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/projects-v2/$project_id/desktop/ingest-drop" -H "Content-Type: application/json" -d '{"files":[{"fileName":"episode.mov","mimeType":"video/mp4","sizeBytes":1024}]}')
accepted=$(echo "$ingest_resp" | jq -r '.ingestPlan.summary.accepted')
[ "$accepted" -ge 1 ]

draft_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/projects-v2/$project_id/desktop/offline-drafts" -H "Content-Type: application/json" -d '{"draftId":"draft_1","clientId":"desktop_1","operations":[{"op":"split_clip"}]}')
draft_status=$(echo "$draft_resp" | jq -r '.draft.status')
[ "$draft_status" = "DIRTY" ] || [ "$draft_status" = "CONFLICT" ]

relink_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/projects-v2/$project_id/desktop/media-relink" -H "Content-Type: application/json" -d '{"missingAssets":[{"assetId":"asset_1","originalFileName":"episode.mov"}],"candidates":[{"fileName":"episode.mov","absolutePath":"/tmp/episode.mov"}],"apply":true}')
matched=$(echo "$relink_resp" | jq -r '.summary.matched')
[ "$matched" -ge 1 ]

notif_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/desktop/notifications")
notif_total=$(echo "$notif_resp" | jq -r '.summary.total')
[ "$notif_total" -ge 0 ]

curl -sS -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/desktop/events" -H "Content-Type: application/json" -d "$(printf '{"projectId":"%s","event":"command_latency","durationMs":83,"outcome":"SUCCESS","sessionId":"sess_1","clientVersion":"1.0.0","platform":"darwin-arm64","channel":"stable"}' "$project_id")" >/dev/null

perf_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/perf-hints")
crash_target=$(echo "$perf_resp" | jq -r '.desktopSlo.crashFreeSessionsTargetPct')
[ "$crash_target" != "null" ]

echo "PHASE5_DESKTOP_E2E_SUCCESS"
