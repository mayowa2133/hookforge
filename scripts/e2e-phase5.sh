#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_phase5_cookiejar.txt"
EMAIL="e2e_phase5_$(date +%s)@example.com"
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

wait_for_internal_job() {
  local job_id="$1"
  for i in $(seq 1 120); do
    local resp
    resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/ai-jobs/$job_id")
    local status
    status=$(echo "$resp" | jq -r ".aiJob.status")
    local progress
    progress=$(echo "$resp" | jq -r ".aiJob.progress")
    echo "internal_job=$job_id poll=$i status=$status progress=$progress" >&2

    if [ "$status" = "DONE" ]; then
      echo "$resp"
      return 0
    fi
    if [ "$status" = "ERROR" ]; then
      echo "Internal job failed: $job_id" >&2
      echo "$resp" | jq . >&2
      return 1
    fi
    sleep 2
  done
  return 1
}

wait_for_public_job() {
  local job_id="$1"
  local key="$2"
  for i in $(seq 1 120); do
    local resp
    resp=$(curl -sS \
      -H "Authorization: Bearer $key" \
      "$BASE/api/public/v1/translate/status/$job_id")
    local status
    status=$(echo "$resp" | jq -r ".job.status")
    local progress
    progress=$(echo "$resp" | jq -r ".job.progress")
    echo "public_job=$job_id poll=$i status=$status progress=$progress" >&2

    if [ "$status" = "DONE" ]; then
      echo "$resp"
      return 0
    fi
    if [ "$status" = "ERROR" ]; then
      echo "Public API job failed: $job_id" >&2
      echo "$resp" | jq . >&2
      return 1
    fi
    sleep 2
  done
  return 1
}

register_user
echo "registered=$EMAIL"

profile_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/workspace/translation-profiles" \
  -H "Content-Type: application/json" \
  -d '{"name":"Phase5 Neutral Glossary","sourceLanguage":"en","tone":"neutral","isDefault":true,"glossary":{"hookforge":"HookForge","captions":"subtitles"}}')

profile_id=$(echo "$profile_resp" | jq -r ".profile.id")
[ -n "$profile_id" ] && [ "$profile_id" != "null" ]
echo "translation_profile_id=$profile_id"

create_key_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/public-api-keys" \
  -H "Content-Type: application/json" \
  -d '{"name":"Phase5 E2E Key"}')

api_key_id=$(echo "$create_key_resp" | jq -r ".apiKey.id")
api_key_secret=$(echo "$create_key_resp" | jq -r ".secret")
[ -n "$api_key_id" ] && [ "$api_key_id" != "null" ]
[ -n "$api_key_secret" ] && [ "$api_key_secret" != "null" ]
echo "api_key_id=$api_key_id"

langs_resp=$(curl -sS -H "Authorization: Bearer $api_key_secret" "$BASE/api/public/v1/translate/supported-languages")
lang_count=$(echo "$langs_resp" | jq -r ".languages | length")
[ "$lang_count" -ge 10 ]
echo "supported_languages=$lang_count"

internal_submit_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/dubbing/submit" \
  -H "Content-Type: application/json" \
  -d "$(printf '{\"sourceUrl\":\"https://example.com/source.mp4\",\"sourceLanguage\":\"en\",\"targetLanguages\":[\"es\",\"fr\"],\"lipDub\":false,\"translationProfileId\":\"%s\"}' "$profile_id")")

internal_job_id=$(echo "$internal_submit_resp" | jq -r ".jobId")
[ -n "$internal_job_id" ] && [ "$internal_job_id" != "null" ]

internal_done_resp=$(wait_for_internal_job "$internal_job_id")
internal_artifact_count=$(echo "$internal_done_resp" | jq -r ".aiJob.artifacts | length")
[ "$internal_artifact_count" -ge 2 ]
internal_mos=$(echo "$internal_done_resp" | jq -r ".aiJob.qualitySummary.mosAverage")
awk "BEGIN { exit !($internal_mos >= 4.2) }"
internal_artifact_mos=$(echo "$internal_done_resp" | jq -r ".aiJob.artifacts[0].quality.mosEstimate")
[ -n "$internal_artifact_mos" ] && [ "$internal_artifact_mos" != "null" ]
internal_artifact_url=$(echo "$internal_done_resp" | jq -r ".aiJob.artifacts[0].outputUrl")
[ -n "$internal_artifact_url" ] && [ "$internal_artifact_url" != "null" ]
internal_download_code=$(curl -sS -o /tmp/hookforge_phase5_internal.mp4 -w "%{http_code}" "$internal_artifact_url")
[ "$internal_download_code" = "200" ]
internal_download_bytes=$(wc -c < /tmp/hookforge_phase5_internal.mp4 | tr -d " ")
[ "$internal_download_bytes" -gt 1000 ]
echo "internal_artifacts=$internal_artifact_count internal_bytes=$internal_download_bytes"

public_submit_resp=$(curl -sS \
  -H "Authorization: Bearer $api_key_secret" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/api/public/v1/translate/submit" \
  -d "$(printf '{\"sourceMediaUrl\":\"https://example.com/public-source.mp4\",\"sourceLanguage\":\"en\",\"targetLanguages\":[\"de\",\"it\"],\"lipDub\":true,\"translationProfileId\":\"%s\"}' "$profile_id")")

public_job_id=$(echo "$public_submit_resp" | jq -r ".jobId")
[ -n "$public_job_id" ] && [ "$public_job_id" != "null" ]

public_done_resp=$(wait_for_public_job "$public_job_id" "$api_key_secret")
public_artifact_count=$(echo "$public_done_resp" | jq -r ".job.artifacts | length")
[ "$public_artifact_count" -ge 2 ]
public_lipsync_median=$(echo "$public_done_resp" | jq -r ".job.qualitySummary.lipSyncMedianMs")
public_lipsync_p95=$(echo "$public_done_resp" | jq -r ".job.qualitySummary.lipSyncP95Ms")
awk "BEGIN { exit !($public_lipsync_median <= 60) }"
awk "BEGIN { exit !($public_lipsync_p95 <= 120) }"
public_lipsync_passed=$(echo "$public_done_resp" | jq -r ".job.artifacts[0].quality.lipSync.passed")
[ "$public_lipsync_passed" = "true" ]
public_artifact_url=$(echo "$public_done_resp" | jq -r ".job.artifacts[0].outputUrl")
[ -n "$public_artifact_url" ] && [ "$public_artifact_url" != "null" ]
public_download_code=$(curl -sS -o /tmp/hookforge_phase5_public.mp4 -w "%{http_code}" "$public_artifact_url")
[ "$public_download_code" = "200" ]
public_download_bytes=$(wc -c < /tmp/hookforge_phase5_public.mp4 | tr -d " ")
[ "$public_download_bytes" -gt 1000 ]
echo "public_artifacts=$public_artifact_count public_bytes=$public_download_bytes"

ledger_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/credits/ledger?take=30")
has_dubbing_debit=$(echo "$ledger_resp" | jq '[.entries[] | select(.feature=="dubbing.translate")] | length')
has_public_debit=$(echo "$ledger_resp" | jq '[.entries[] | select(.feature=="public-api.translate")] | length')
[ "$has_dubbing_debit" -ge 1 ]
[ "$has_public_debit" -ge 1 ]
echo "ledger_dubbing_entries=$has_dubbing_debit ledger_public_entries=$has_public_debit"

disable_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/public-api-keys/$api_key_id/disable")
disable_status=$(echo "$disable_resp" | jq -r ".apiKey.status")
[ "$disable_status" = "DISABLED" ]
echo "api_key_disabled=true"

disabled_code=$(curl -sS -o /tmp/hookforge_phase5_disabled.json -w "%{http_code}" \
  -H "Authorization: Bearer $api_key_secret" \
  "$BASE/api/public/v1/translate/supported-languages")
[ "$disabled_code" = "403" ]

echo "PHASE5_E2E_SUCCESS"
