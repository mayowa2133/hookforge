#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE="/tmp/hookforge_e2e_descript_core_cookie.txt"
EMAIL="e2e_descript_core_$(date +%s)@example.com"
PASSWORD="StrongPass123!"
UPLOAD_HEADERS="/tmp/hookforge_descript_recording_headers.txt"
OUTPUT_MP4="/tmp/hookforge_descript_core.mp4"
SOURCE_FILE="public/demo-assets/demo-portrait.mp4"

rm -f "$COOKIE" "$UPLOAD_HEADERS" "$OUTPUT_MP4" /tmp/hookforge_descript_render_blocked.json

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

desktop_config_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/desktop/config")
desktop_supported=$(echo "$desktop_config_resp" | jq -r ".desktop.supported")
desktop_shell=$(echo "$desktop_config_resp" | jq -r ".desktop.shell")
cutover_default=$(echo "$desktop_config_resp" | jq -r ".cutover.defaultEditorShell")
[ "$desktop_supported" = "true" ]
[ "$desktop_shell" = "web-first-desktop-shell" ]
[ "$cutover_default" = "OPENCUT" ]

desktop_event_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/desktop/events" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"projectId":"%s","event":"editor_boot","outcome":"SUCCESS","durationMs":2100,"metadata":{"source":"e2e_descript_core"}}' "$project_id")")
desktop_tracked=$(echo "$desktop_event_resp" | jq -r ".tracked")
[ "$desktop_tracked" = "true" ]

perf_hints_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/perf-hints")
perf_project_id=$(echo "$perf_hints_resp" | jq -r ".projectId")
perf_editor_budget=$(echo "$perf_hints_resp" | jq -r ".budgets.editorOpenP95Ms")
[ "$perf_project_id" = "$project_id" ]
[ "$perf_editor_budget" -ge 1000 ]

queue_health_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/ops/queues/health")
queue_count=$(echo "$queue_health_resp" | jq -r ".queues | length")
[ "$queue_count" -ge 1 ]
echo "phase6_desktop_ok=true queues=$queue_count"

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

ranges_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/transcript/ranges?language=en&offset=0&limit=20")
ranges_count=$(echo "$ranges_resp" | jq -r '.ranges | length')
[ "$ranges_count" -gt 0 ]
start_word_index=$(echo "$ranges_resp" | jq -r '.ranges[0].startWordIndex')
end_word_index=$(echo "$ranges_resp" | jq -r '.ranges[0].endWordIndex')
[ "$start_word_index" -ge 0 ]
[ "$end_word_index" -ge "$start_word_index" ]

range_preview_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/transcript/ranges/preview" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"language":"en","selection":{"startWordIndex":%s,"endWordIndex":%s},"minConfidenceForRipple":0.86}' "$start_word_index" "$end_word_index")")
range_preview_mode=$(echo "$range_preview_resp" | jq -r ".mode")
[ "$range_preview_mode" = "PREVIEW" ]

range_apply_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/transcript/ranges/apply" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"language":"en","selection":{"startWordIndex":%s,"endWordIndex":%s},"minConfidenceForRipple":0.86}' "$start_word_index" "$end_word_index")")
range_apply_mode=$(echo "$range_apply_resp" | jq -r ".mode")
[ "$range_apply_mode" = "APPLY" ]

speaker_batch_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/transcript/speakers/batch" \
  -H "Content-Type: application/json" \
  -d '{"language":"en","speakerLabel":"Host","maxConfidence":1}')
speaker_batch_affected=$(echo "$speaker_batch_resp" | jq -r ".affectedSegments")
[ "$speaker_batch_affected" -gt 0 ]

issues_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/transcript/issues?language=en&minConfidence=0.86&limit=200")
issues_total=$(echo "$issues_resp" | jq -r ".totalIssues")
[ "$issues_total" -ge 0 ]
echo "range_ops_ok=true speaker_batch_affected=$speaker_batch_affected transcript_issues=$issues_total"

audio_analysis_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/audio/analysis?language=en&maxCandidates=60&maxConfidence=0.92")
audio_tracks=$(echo "$audio_analysis_resp" | jq -r ".analysis.audioTrackCount")
audio_ready=$(echo "$audio_analysis_resp" | jq -r ".analysis.readyForApply")
[ "$audio_ready" = "true" ]

audio_preview_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/audio/enhance/preview" \
  -H "Content-Type: application/json" \
  -d '{"language":"en","preset":"dialogue_enhance","targetLufs":-14,"intensity":1}')
audio_preview_mode=$(echo "$audio_preview_resp" | jq -r ".mode")
audio_preview_ops=$(echo "$audio_preview_resp" | jq -r ".timelineOps | length")
[ "$audio_preview_mode" = "PREVIEW" ]
[ "$audio_preview_ops" -gt 0 ]

audio_apply_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/audio/enhance/apply" \
  -H "Content-Type: application/json" \
  -d '{"language":"en","preset":"dialogue_enhance","targetLufs":-14,"intensity":1}')
audio_apply_mode=$(echo "$audio_apply_resp" | jq -r ".mode")
audio_apply_ok=$(echo "$audio_apply_resp" | jq -r ".applied")
audio_undo_token=$(echo "$audio_apply_resp" | jq -r ".undoToken")
[ "$audio_apply_mode" = "APPLY" ]
[ "$audio_apply_ok" = "true" ]
[ -n "$audio_undo_token" ] && [ "$audio_undo_token" != "null" ]

filler_preview_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/audio/filler/preview" \
  -H "Content-Type: application/json" \
  -d '{"language":"en","maxCandidates":20,"maxConfidence":1,"minConfidenceForRipple":0.86}')
filler_preview_mode=$(echo "$filler_preview_resp" | jq -r ".mode")
[ "$filler_preview_mode" = "PREVIEW" ]

filler_apply_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/audio/filler/apply" \
  -H "Content-Type: application/json" \
  -d '{"language":"en","maxCandidates":20,"maxConfidence":1,"minConfidenceForRipple":0.86}')
filler_apply_mode=$(echo "$filler_apply_resp" | jq -r ".mode")
[ "$filler_apply_mode" = "APPLY" ]

audio_undo_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/audio/enhance/undo" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"undoToken":"%s"}' "$audio_undo_token")")
audio_restored=$(echo "$audio_undo_resp" | jq -r ".restored")
[ "$audio_restored" = "true" ]
echo "phase3_audio_ok=true tracks=$audio_tracks"

chat_plan_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/chat/plan" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"split first clip and tighten intro pacing"}')
plan_id=$(echo "$chat_plan_resp" | jq -r ".planId")
plan_hash=$(echo "$chat_plan_resp" | jq -r ".planRevisionHash")
safety_mode=$(echo "$chat_plan_resp" | jq -r ".safetyMode")
selected_item_id=$(echo "$chat_plan_resp" | jq -r '.diffGroups[] | select(.group=="timeline") | .items[] | select(.type=="operation") | .id' | head -n 1)
[ -n "$plan_id" ] && [ "$plan_id" != "null" ]
[ -n "$plan_hash" ] && [ "$plan_hash" != "null" ]
[ -n "$safety_mode" ] && [ "$safety_mode" != "null" ]
[ -n "$selected_item_id" ] && [ "$selected_item_id" != "null" ]

apply_body=$(jq -n \
  --arg planId "$plan_id" \
  --arg planRevisionHash "$plan_hash" \
  --arg selectedItemId "$selected_item_id" \
  '{
    planId: $planId,
    planRevisionHash: $planRevisionHash,
    confirmed: true,
    operationDecisions: [
      { itemId: $selectedItemId, accepted: true }
    ]
  }')

chat_apply_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/chat/apply" \
  -H "Content-Type: application/json" \
  -d "$apply_body")
undo_token=$(echo "$chat_apply_resp" | jq -r ".undoToken")
applied=$(echo "$chat_apply_resp" | jq -r ".applied")
[ "$applied" = "true" ]
[ -n "$undo_token" ] && [ "$undo_token" != "null" ]

chat_undo_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/chat/undo" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"undoToken":"%s","lineageMode":"latest"}' "$undo_token")")
restored=$(echo "$chat_undo_resp" | jq -r ".restored")
[ "$restored" = "true" ]

chat_sessions_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/chat/sessions?limit=10")
chat_sessions_count=$(echo "$chat_sessions_resp" | jq -r ".sessions | length")
[ "$chat_sessions_count" -ge 1 ]

revision_graph_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/revisions/graph?limit=50")
revision_graph_nodes=$(echo "$revision_graph_resp" | jq -r ".nodeCount")
revision_graph_edges=$(echo "$revision_graph_resp" | jq -r ".edgeCount")
[ "$revision_graph_nodes" -ge 1 ]
[ "$revision_graph_edges" -ge 0 ]
echo "chat_phase4_ok=true safety_mode=$safety_mode sessions=$chat_sessions_count nodes=$revision_graph_nodes"

share_link_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/share-links" \
  -H "Content-Type: application/json" \
  -d '{"scope":"COMMENT","expiresInDays":14}')
share_link_id=$(echo "$share_link_resp" | jq -r ".shareLink.id")
share_link_url=$(echo "$share_link_resp" | jq -r ".shareLink.shareUrl")
[ -n "$share_link_id" ] && [ "$share_link_id" != "null" ]
[ -n "$share_link_url" ] && [ "$share_link_url" != "null" ]

review_comment_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/review/comments" \
  -H "Content-Type: application/json" \
  -d '{"body":"Great cut, trim first beat by 200ms.","anchorMs":300}')
review_comment_id=$(echo "$review_comment_resp" | jq -r ".comment.id")
[ -n "$review_comment_id" ] && [ "$review_comment_id" != "null" ]

review_comments_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" "$BASE/api/projects-v2/$project_id/review/comments")
review_comments_count=$(echo "$review_comments_resp" | jq -r ".comments | length")
[ "$review_comments_count" -ge 1 ]

resolve_comment_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X PATCH "$BASE/api/projects-v2/$project_id/review/comments/$review_comment_id" \
  -H "Content-Type: application/json" \
  -d '{"status":"RESOLVED"}')
resolved_status=$(echo "$resolve_comment_resp" | jq -r ".comment.status")
[ "$resolved_status" = "RESOLVED" ]

export_profile_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/export/profile" \
  -H "Content-Type: application/json" \
  -d '{"createProfile":{"name":"E2E Social Profile","resolution":"1080x1920","fps":30,"container":"mp4"}}')
export_applied=$(echo "$export_profile_resp" | jq -r ".applied")
export_profile_id=$(echo "$export_profile_resp" | jq -r ".profile.id")
[ "$export_applied" = "true" ]
[ -n "$export_profile_id" ] && [ "$export_profile_id" != "null" ]
echo "phase5_collab_ok=true comments=$review_comments_count share_link=$share_link_id export_profile=$export_profile_id"

review_reject_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/review/approve" \
  -H "Content-Type: application/json" \
  -d '{"status":"REJECTED","note":"Need tighter hook","requireApproval":true}')
reject_status=$(echo "$review_reject_resp" | jq -r ".decision.status")
[ "$reject_status" = "REJECTED" ]

render_block_code=$(curl -sS -c "$COOKIE" -b "$COOKIE" -o /tmp/hookforge_descript_render_blocked.json -w "%{http_code}" \
  -X POST "$BASE/api/projects-v2/$project_id/render/final")
[ "$render_block_code" = "400" ]
blocked_error=$(jq -r ".error" /tmp/hookforge_descript_render_blocked.json)
[ "$blocked_error" != "null" ]

review_approve_resp=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST "$BASE/api/projects-v2/$project_id/review/approve" \
  -H "Content-Type: application/json" \
  -d '{"status":"APPROVED","note":"Approved for publish","requireApproval":true}')
approve_status=$(echo "$review_approve_resp" | jq -r ".decision.status")
[ "$approve_status" = "APPROVED" ]

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
