#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_phase3_cookiejar.txt"
EMAIL="e2e_phase3_$(date +%s)@example.com"
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

actors_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/ai-creator/actors")
actor_id=$(echo "$actors_resp" | jq -r ".actors[0].id")
[ -n "$actor_id" ] && [ "$actor_id" != "null" ]
echo "actor=$actor_id"

presign_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/ai-creator/echo/presign" \
  -H "Content-Type: application/json" \
  -d '{"fileName":"sample.wav","mimeType":"audio/wav"}')

echo "$presign_resp" | jq . >/dev/null
sample_upload_url=$(echo "$presign_resp" | jq -r ".uploadUrl")
sample_storage_key=$(echo "$presign_resp" | jq -r ".storageKey")
[ -n "$sample_upload_url" ] && [ "$sample_upload_url" != "null" ]
[ -n "$sample_storage_key" ] && [ "$sample_storage_key" != "null" ]

curl -sS -X PUT "$sample_upload_url" -H "Content-Type: audio/wav" --data-binary @"public/demo-assets/sfx-notify.wav" >/dev/null

echo_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/ai-creator/echo/submit" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"name":"Phase3 Voice","language":"en","sampleStorageKey":"%s","consent":{"subjectName":"Phase3 User","subjectEmail":"phase3@example.com","verified":true}}' "$sample_storage_key")")

echo_job_id=$(echo "$echo_resp" | jq -r ".aiJobId")
voice_profile_id=$(echo "$echo_resp" | jq -r ".voiceProfile.id")
[ -n "$echo_job_id" ] && [ "$echo_job_id" != "null" ]
[ -n "$voice_profile_id" ] && [ "$voice_profile_id" != "null" ]
wait_for_ai_job "$echo_job_id"
echo "echo_voice_profile=$voice_profile_id"

twin_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/ai-creator/twins" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"name":"Phase3 Twin","actorId":"%s","voiceProfileId":"%s","consent":{"subjectName":"Phase3 User","subjectEmail":"phase3@example.com","verified":true}}' "$actor_id" "$voice_profile_id")")

twin_id=$(echo "$twin_resp" | jq -r ".twin.id")
[ -n "$twin_id" ] && [ "$twin_id" != "null" ]
echo "twin=$twin_id"

creator_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/ai-creator/generate" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"script":"HookForge phase3 end to end test","actorId":"%s","voiceId":"%s","twinId":"%s","durationSec":20,"templateSlug":"green-screen-commentator"}' "$actor_id" "$voice_profile_id" "$twin_id")")

creator_job_id=$(echo "$creator_resp" | jq -r ".aiJobId")
legacy_project_id=$(echo "$creator_resp" | jq -r ".legacyProjectId")
creator_rating=$(echo "$creator_resp" | jq -r ".qualitySummary.ratingScore")
creator_uplift=$(echo "$creator_resp" | jq -r ".qualitySummary.candidateUpliftPct")
creator_candidates=$(echo "$creator_resp" | jq -r ".rankedCandidates | length")
[ -n "$creator_job_id" ] && [ "$creator_job_id" != "null" ]
[ -n "$legacy_project_id" ] && [ "$legacy_project_id" != "null" ]
[ "$creator_candidates" -gt 1 ]
awk "BEGIN {exit !($creator_rating >= 4.2)}"
awk "BEGIN {exit !($creator_uplift > 0)}"
wait_for_ai_job "$creator_job_id"
echo "generated_project=$legacy_project_id"

creator_job_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/ai-jobs/$creator_job_id")
phase3_rating=$(echo "$creator_job_resp" | jq -r ".aiJob.output.sideEffects.phase3.qualitySummary.ratingScore")
phase3_uplift=$(echo "$creator_job_resp" | jq -r ".aiJob.output.sideEffects.phase3.qualitySummary.candidateUpliftPct")
awk "BEGIN {exit !($phase3_rating >= 4.2)}"
awk "BEGIN {exit !($phase3_uplift > 0)}"
echo "creator_quality_rating=$phase3_rating uplift=$phase3_uplift"

project_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects/$legacy_project_id")
project_status=$(echo "$project_resp" | jq -r ".project.status")
asset_count=$(echo "$project_resp" | jq -r ".project.assets | length")
[ "$project_status" = "READY" ]
[ "$asset_count" -ge 2 ]
echo "project_status=$project_status assets=$asset_count"

render_job_id=$(enqueue_render "$legacy_project_id")
[ -n "$render_job_id" ] && [ "$render_job_id" != "null" ]
output_url=$(wait_for_render_done "$render_job_id")
[ -n "$output_url" ] && [ "$output_url" != "null" ]

render_code=$(curl -sS -o /tmp/hookforge_phase3.mp4 -w "%{http_code}" "$output_url")
[ "$render_code" = "200" ]
render_bytes=$(wc -c < /tmp/hookforge_phase3.mp4 | tr -d " ")
[ "$render_bytes" -gt 1000 ]
echo "phase3_render_bytes=$render_bytes"

profiles_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/ai-creator/profiles")
profiles_count=$(echo "$profiles_resp" | jq -r ".voiceProfiles | length")
[ "$profiles_count" -gt 0 ]
echo "voice_profiles=$profiles_count"

echo "PHASE3_E2E_SUCCESS"
