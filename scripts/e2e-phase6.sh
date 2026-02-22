#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE_ONE="/tmp/hookforge_e2e_phase6_cookie_one.txt"
COOKIE_TWO="/tmp/hookforge_e2e_phase6_cookie_two.txt"
EMAIL_ONE="e2e_phase6_owner_$(date +%s)@example.com"
EMAIL_TWO="e2e_phase6_member_$(date +%s)@example.com"
PASSWORD="StrongPass123!"

rm -f "$COOKIE_ONE" "$COOKIE_TWO"

register_user() {
  local cookie_file="$1"
  local email="$2"
  local payload
  payload=$(printf '{"email":"%s","password":"%s"}' "$email" "$PASSWORD")
  curl -sS -c "$cookie_file" -b "$cookie_file" \
    -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "$payload" >/dev/null
}

register_user "$COOKIE_ONE" "$EMAIL_ONE"
register_user "$COOKIE_TWO" "$EMAIL_TWO"
echo "registered_owner=$EMAIL_ONE"
echo "registered_member=$EMAIL_TWO"

plans_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" "$BASE/api/billing/plans")
plan_count=$(echo "$plans_resp" | jq -r ".plans | length")
pack_count=$(echo "$plans_resp" | jq -r ".creditPacks | length")
[ "$plan_count" -ge 3 ]
[ "$pack_count" -ge 3 ]
echo "plans=$plan_count packs=$pack_count"

subscribe_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X POST "$BASE/api/billing/subscribe" \
  -H "Content-Type: application/json" \
  -d '{"tier":"PRO"}')
subscribe_status=$(echo "$subscribe_resp" | jq -r ".status")
balance_after_subscribe=$(echo "$subscribe_resp" | jq -r ".balance")
[ "$subscribe_status" = "SUBSCRIBED" ] || [ "$subscribe_status" = "UNCHANGED" ]
[ "$balance_after_subscribe" -gt 0 ]
echo "subscribe_status=$subscribe_status balance_after_subscribe=$balance_after_subscribe"

pack_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X POST "$BASE/api/billing/credit-packs/purchase" \
  -H "Content-Type: application/json" \
  -d '{"packId":"pack_500"}')
pack_status=$(echo "$pack_resp" | jq -r ".status")
balance_after_pack=$(echo "$pack_resp" | jq -r ".balance")
[ "$pack_status" = "PURCHASED" ]
[ "$balance_after_pack" -gt "$balance_after_subscribe" ]
echo "pack_status=$pack_status balance_after_pack=$balance_after_pack"

usage_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" "$BASE/api/billing/usage-alerts")
usage_metrics=$(echo "$usage_resp" | jq -r ".metrics.spent7d")
echo "usage_spent7d=$usage_metrics"

member_add_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X POST "$BASE/api/workspace/members" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"email":"%s","role":"EDITOR"}' "$EMAIL_TWO")")
member_added_email=$(echo "$member_add_resp" | jq -r ".member.email")
[ "$member_added_email" = "$EMAIL_TWO" ]
echo "member_added=$member_added_email"

members_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" "$BASE/api/workspace/members")
members_count=$(echo "$members_resp" | jq -r ".members | length")
[ "$members_count" -ge 2 ]
member_id=$(echo "$members_resp" | jq -r --arg EMAIL "$EMAIL_TWO" '.members[] | select(.email==$EMAIL) | .id')
[ -n "$member_id" ] && [ "$member_id" != "null" ]
echo "members_count=$members_count"

update_role_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X PATCH "$BASE/api/workspace/members/$member_id" \
  -H "Content-Type: application/json" \
  -d '{"role":"ADMIN"}')
updated_role=$(echo "$update_role_resp" | jq -r ".member.role")
[ "$updated_role" = "ADMIN" ]
echo "updated_role=$updated_role"

create_project_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X POST "$BASE/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"templateSlug":"green-screen-commentator","title":"Phase6 Shared Project"}')
project_id=$(echo "$create_project_resp" | jq -r ".project.id")
[ -n "$project_id" ] && [ "$project_id" != "null" ]
echo "shared_project=$project_id"

asset_file="public/demo-assets/template-green-screen.svg"
asset_size=$(wc -c < "$asset_file" | tr -d ' ')
initiate_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X POST "$BASE/api/mobile/uploads/resumable/initiate" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"projectId":"%s","slotKey":"background","fileName":"phase6-bg.svg","mimeType":"image/svg+xml","sizeBytes":%s,"totalParts":1}' "$project_id" "$asset_size")")
upload_session_id=$(echo "$initiate_resp" | jq -r ".session.id")
[ -n "$upload_session_id" ] && [ "$upload_session_id" != "null" ]
echo "upload_session=$upload_session_id"

part_url_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X POST "$BASE/api/mobile/uploads/resumable/$upload_session_id/part-url" \
  -H "Content-Type: application/json" \
  -d '{"partNumber":1}')
part_upload_url=$(echo "$part_url_resp" | jq -r ".uploadUrl")
[ -n "$part_upload_url" ] && [ "$part_upload_url" != "null" ]

put_headers=$(mktemp)
curl -sS -D "$put_headers" -o /dev/null -X PUT --upload-file "$asset_file" "$part_upload_url"
part_etag=$(awk 'BEGIN{IGNORECASE=1} /^ETag:/ {print $2}' "$put_headers" | tr -d '\r"')
rm -f "$put_headers"
[ -n "$part_etag" ] && [ "$part_etag" != "null" ]

part_complete_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X POST "$BASE/api/mobile/uploads/resumable/$upload_session_id/part-complete" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"partNumber":1,"eTag":"%s"}' "$part_etag")")
completed_parts=$(echo "$part_complete_resp" | jq -r ".progress.completedParts")
[ "$completed_parts" -eq 1 ]

upload_status_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" "$BASE/api/mobile/uploads/resumable/$upload_session_id")
status_progress=$(echo "$upload_status_resp" | jq -r ".progress.progressPct")
[ "$status_progress" -eq 100 ]

complete_upload_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X POST "$BASE/api/mobile/uploads/resumable/$upload_session_id/complete")
completed_status=$(echo "$complete_upload_resp" | jq -r ".session.status")
registered_slot=$(echo "$complete_upload_resp" | jq -r ".registration.asset.slotKey")
[ "$completed_status" = "COMPLETED" ]
[ "$registered_slot" = "background" ]
echo "upload_completed_status=$completed_status"

telemetry_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X POST "$BASE/api/mobile/telemetry" \
  -H "Content-Type: application/json" \
  -d '{"events":[{"sessionId":"phase6-mobile-session-1","platform":"ios","event":"SESSION_START"},{"sessionId":"phase6-mobile-session-1","platform":"ios","event":"WORKFLOW_START","workflowId":"creator_to_render"},{"sessionId":"phase6-mobile-session-1","platform":"ios","event":"WORKFLOW_COMPLETE","workflowId":"creator_to_render","latencyMs":1820},{"sessionId":"phase6-mobile-session-1","platform":"ios","event":"WORKFLOW_START","workflowId":"template_edit_render"},{"sessionId":"phase6-mobile-session-1","platform":"ios","event":"WORKFLOW_COMPLETE","workflowId":"template_edit_render","latencyMs":1440},{"sessionId":"phase6-mobile-session-1","platform":"ios","event":"WORKFLOW_START","workflowId":"localization_dub"},{"sessionId":"phase6-mobile-session-1","platform":"ios","event":"WORKFLOW_COMPLETE","workflowId":"localization_dub","latencyMs":2360},{"sessionId":"phase6-mobile-session-1","platform":"ios","event":"UPLOAD_RESUME"},{"sessionId":"phase6-mobile-session-1","platform":"ios","event":"SESSION_END"}]}')
telemetry_ingested=$(echo "$telemetry_resp" | jq -r ".ingested")
[ "$telemetry_ingested" -ge 9 ]

workflows_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" "$BASE/api/mobile/workflows/top")
workflow_count=$(echo "$workflows_resp" | jq -r ".workflows | length")
top_gap=$(echo "$workflows_resp" | jq -r ".topWorkflowGapPct")
[ "$workflow_count" -ge 3 ]
awk -v gap="$top_gap" 'BEGIN { exit !(gap <= 10) }'
echo "mobile_workflows=$workflow_count top_gap=$top_gap"

shared_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" "$BASE/api/workspace/projects")
shared_count=$(echo "$shared_resp" | jq -r ".projects | length")
shared_match=$(echo "$shared_resp" | jq -r --arg PROJECT "$project_id" '[.projects[] | select(.id==$PROJECT)] | length')
[ "$shared_count" -ge 1 ]
[ "$shared_match" -eq 1 ]
echo "shared_projects=$shared_count"

mobile_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" "$BASE/api/mobile/config")
mobile_platforms=$(echo "$mobile_resp" | jq -r ".platforms | length")
mobile_resumable=$(echo "$mobile_resp" | jq -r ".captureCapabilities.resumableUploads")
[ "$mobile_platforms" -ge 2 ]
[ "$mobile_resumable" = "true" ]
echo "mobile_platforms=$mobile_platforms"

mobile_health_resp=$(curl -sS "$BASE/api/mobile/health")
mobile_health_ok=$(echo "$mobile_health_resp" | jq -r ".ok")
mobile_crash_target=$(echo "$mobile_health_resp" | jq -r ".mobile.meetsCrashFreeTarget")
mobile_gap_target=$(echo "$mobile_health_resp" | jq -r ".mobile.meetsWorkflowGapTarget")
[ "$mobile_health_ok" = "true" ]
[ "$mobile_crash_target" = "true" ]
[ "$mobile_gap_target" = "true" ]

remove_member_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" \
  -X DELETE "$BASE/api/workspace/members/$member_id")
removed_member_id=$(echo "$remove_member_resp" | jq -r ".removedMemberId")
[ "$removed_member_id" = "$member_id" ]
echo "removed_member=$removed_member_id"

members_after_resp=$(curl -sS -c "$COOKIE_ONE" -b "$COOKIE_ONE" "$BASE/api/workspace/members")
members_after_count=$(echo "$members_after_resp" | jq -r ".members | length")
[ "$members_after_count" -eq 1 ]
echo "members_after_count=$members_after_count"

echo "PHASE6_E2E_SUCCESS"
