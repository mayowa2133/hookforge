#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_descript_plus_cookie.txt"
EMAIL="e2e_descript_plus_$(date +%s)@example.com"
PASSWORD="StrongPass123!"

rm -f "$COOKIE"

register_payload=$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")
curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "$register_payload" >/dev/null

project_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2" \
  -H "Content-Type: application/json" \
  -d '{"mode":"FREEFORM","title":"E2E Descript Plus"}')
project_id=$(echo "$project_resp" | jq -r ".project.id")
[ -n "$project_id" ] && [ "$project_id" != "null" ]

studio_create=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/studio/rooms" \
  -H "Content-Type: application/json" \
  -d '{"name":"Team Standup Studio","region":"us-east"}')
room_id=$(echo "$studio_create" | jq -r ".room.id")
[ -n "$room_id" ] && [ "$room_id" != "null" ]

studio_list=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/studio/rooms")
listed_room_id=$(echo "$studio_list" | jq -r ".rooms[0].id")
[ -n "$listed_room_id" ] && [ "$listed_room_id" != "null" ]

studio_join=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/studio/rooms/$room_id/join-token" \
  -H "Content-Type: application/json" \
  -d '{"participantName":"Host User","role":"HOST"}')
join_token=$(echo "$studio_join" | jq -r ".join.token")
[ -n "$join_token" ] && [ "$join_token" != "null" ]

curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/studio/rooms/$room_id/start-recording" \
  -H "Content-Type: application/json" >/dev/null
studio_stop=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/studio/rooms/$room_id/stop-recording" \
  -H "Content-Type: application/json")
artifacts_created=$(echo "$studio_stop" | jq -r ".artifactsCreated")
[ "$artifacts_created" -ge 1 ]
timeline_linked=$(echo "$studio_stop" | jq -r ".timeline.linked")
generated_clip_count=$(echo "$studio_stop" | jq -r ".timeline.generatedClipCount")
[ "$timeline_linked" = "true" ]
[ "$generated_clip_count" -ge 1 ]

recording_session=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/recordings/session" \
  -H "Content-Type: application/json" \
  -d '{"mode":"SCREEN_CAMERA","fileName":"recoverable.webm","mimeType":"video/webm","sizeBytes":6291456,"totalParts":2,"partSizeBytes":5242880,"autoTranscribe":false,"language":"en"}')
recording_session_id=$(echo "$recording_session" | jq -r ".session.id")
[ -n "$recording_session_id" ] && [ "$recording_session_id" != "null" ]
curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/recordings/session/$recording_session_id/cancel" \
  -H "Content-Type: application/json" >/dev/null
recovery_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/recordings/session/$recording_session_id/recover" \
  -H "Content-Type: application/json" \
  -d '{"mode":"resume","reason":"e2e_resume"}')
recovery_resumed=$(echo "$recovery_resp" | jq -r ".resumed")
recovery_status=$(echo "$recovery_resp" | jq -r ".status")
[ "$recovery_resumed" = "true" ]
[ "$recovery_status" = "ACTIVE" ]

autopilot_plan=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/autopilot/plan" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"tighten pacing and improve intro hook"}')
autopilot_session_id=$(echo "$autopilot_plan" | jq -r ".sessionId")
autopilot_plan_hash=$(echo "$autopilot_plan" | jq -r ".planRevisionHash")
[ -n "$autopilot_session_id" ] && [ "$autopilot_session_id" != "null" ]
[ -n "$autopilot_plan_hash" ] && [ "$autopilot_plan_hash" != "null" ]

autopilot_sessions=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/autopilot/sessions")
autopilot_count=$(echo "$autopilot_sessions" | jq -r '.sessions | length')
[ "$autopilot_count" -ge 1 ]

review_request=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/review/requests" \
  -H "Content-Type: application/json" \
  -d '{"title":"Request final approval","note":"Please approve final export."}')
request_id=$(echo "$review_request" | jq -r ".request.id")
[ -n "$request_id" ] && [ "$request_id" != "null" ]

review_decision=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/review/requests/$request_id/decision" \
  -H "Content-Type: application/json" \
  -d '{"status":"APPROVED","note":"Approved."}')
decision_status=$(echo "$review_decision" | jq -r ".request.status")
[ "$decision_status" = "APPROVED" ]

publish_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/publish/connectors/package/export" \
  -H "Content-Type: application/json" \
  -d '{"title":"Creator Pack Export","visibility":"private"}')
publish_job_id=$(echo "$publish_resp" | jq -r ".publishJob.id")
[ -n "$publish_job_id" ] && [ "$publish_job_id" != "null" ]

publish_status_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/publish/jobs/$publish_job_id")
publish_status=$(echo "$publish_status_resp" | jq -r ".publishJob.status")
[[ "$publish_status" == "DONE" || "$publish_status" == "ERROR" ]]

scorecard=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/parity/scorecard")
overall_score=$(echo "$scorecard" | jq -r ".overallScore")
[ "$overall_score" != "null" ]

benchmark_run=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/parity/benchmarks/run" \
  -H "Content-Type: application/json" \
  -d '{"passThreshold":55}')
run_id=$(echo "$benchmark_run" | jq -r ".run.id")
[ -n "$run_id" ] && [ "$run_id" != "null" ]

benchmark_status=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/parity/benchmarks/$run_id")
result_count=$(echo "$benchmark_status" | jq -r '.results | length')
[ "$result_count" -ge 1 ]

echo "DESCRIPT_PLUS_E2E_SUCCESS"
