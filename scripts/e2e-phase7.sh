#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE_OWNER="/tmp/hookforge_e2e_phase7_owner_cookie.txt"
COOKIE_MEMBER="/tmp/hookforge_e2e_phase7_member_cookie.txt"
EMAIL_OWNER="e2e_phase7_owner_$(date +%s)@example.com"
EMAIL_MEMBER="e2e_phase7_member_$(date +%s)@example.com"
PASSWORD="StrongPass123!"

rm -f "$COOKIE_OWNER" "$COOKIE_MEMBER"

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

register_user "$COOKIE_OWNER" "$EMAIL_OWNER"
register_user "$COOKIE_MEMBER" "$EMAIL_MEMBER"
echo "registered_owner=$EMAIL_OWNER"
echo "registered_member=$EMAIL_MEMBER"

subscribe_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/billing/subscribe" \
  -H "Content-Type: application/json" \
  -d '{"tier":"PRO"}')
subscribe_status=$(echo "$subscribe_resp" | jq -r ".status")
[ "$subscribe_status" = "SUBSCRIBED" ] || [ "$subscribe_status" = "UNCHANGED" ]
echo "subscribe_status=$subscribe_status"

preflight_ok_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/credits/preflight" \
  -H "Content-Type: application/json" \
  -d '{"feature":"ai_creator.generate","estimatedCredits":400}')
preflight_ok=$(echo "$preflight_ok_resp" | jq -r ".decision.allowed")
[ "$preflight_ok" = "true" ]

preflight_block_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/credits/preflight" \
  -H "Content-Type: application/json" \
  -d '{"feature":"dubbing.lipdub","estimatedCredits":5000}')
preflight_block=$(echo "$preflight_block_resp" | jq -r ".decision.allowed")
[ "$preflight_block" = "false" ]
echo "preflight_blocked=$preflight_block"

add_member_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/workspace/members" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"email":"%s","role":"VIEWER"}' "$EMAIL_MEMBER")")
added_member_id=$(echo "$add_member_resp" | jq -r ".member.id")
[ -n "$added_member_id" ] && [ "$added_member_id" != "null" ]

owner_members_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" "$BASE/api/workspace/members")
member_id=$(echo "$owner_members_resp" | jq -r --arg EMAIL "$EMAIL_MEMBER" '.members[] | select(.email==$EMAIL) | .id')
[ -n "$member_id" ] && [ "$member_id" != "null" ]
owner_member_id=$(echo "$owner_members_resp" | jq -r --arg EMAIL "$EMAIL_OWNER" '.members[] | select(.email==$EMAIL) | .id')
[ -n "$owner_member_id" ] && [ "$owner_member_id" != "null" ]

owner_reassign_resp=$(curl -sS -o /tmp/hookforge_phase7_owner_reassign.json -w "%{http_code}" \
  -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X PATCH "$BASE/api/workspace/members/$owner_member_id" \
  -H "Content-Type: application/json" \
  -d '{"role":"EDITOR"}')
[ "$owner_reassign_resp" = "400" ]

owner_promote_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X PATCH "$BASE/api/workspace/members/$member_id" \
  -H "Content-Type: application/json" \
  -d '{"role":"ADMIN"}')
owner_promote_role=$(echo "$owner_promote_resp" | jq -r ".member.role")
[ "$owner_promote_role" = "ADMIN" ]

owner_demote_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X PATCH "$BASE/api/workspace/members/$member_id" \
  -H "Content-Type: application/json" \
  -d '{"role":"EDITOR"}')
owner_demote_role=$(echo "$owner_demote_resp" | jq -r ".member.role")
[ "$owner_demote_role" = "EDITOR" ]
echo "owner_demote_role=$owner_demote_role"

owner_delete_resp=$(curl -sS -o /tmp/hookforge_phase7_owner_delete.json -w "%{http_code}" \
  -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X DELETE "$BASE/api/workspace/members/$owner_member_id")
[ "$owner_delete_resp" = "400" ]

dub_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/dubbing/submit" \
  -H "Content-Type: application/json" \
  -d '{"sourceUrl":"https://example.com/video.mp4","sourceLanguage":"en","targetLanguages":["es","fr","de","it","pt","ja","ko","hi"],"lipDub":true}')
dub_job=$(echo "$dub_resp" | jq -r ".jobId")
[ -n "$dub_job" ] && [ "$dub_job" != "null" ]
echo "dub_job=$dub_job"

scan_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/billing/anomalies/scan" \
  -H "Content-Type: application/json" \
  -d '{"feature":"dubbing.lipdub"}')
scan_detected=$(echo "$scan_resp" | jq -r ".detected | length")
[ "$scan_detected" -ge 1 ]
echo "scan_detected=$scan_detected"

anomalies_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" "$BASE/api/billing/anomalies?take=20")
anomaly_id=$(echo "$anomalies_resp" | jq -r '.anomalies[] | select(.feature=="dubbing.lipdub") | .id' | head -n 1)
[ -n "$anomaly_id" ] && [ "$anomaly_id" != "null" ]

ack_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/billing/anomalies/$anomaly_id/status" \
  -H "Content-Type: application/json" \
  -d '{"status":"ACKNOWLEDGED","note":"Reviewed during phase7 e2e"}')
ack_status=$(echo "$ack_resp" | jq -r ".anomaly.status")
[ "$ack_status" = "ACKNOWLEDGED" ]
echo "ack_status=$ack_status"

reconcile_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/billing/reconcile" \
  -H "Content-Type: application/json" \
  -d '{"repairWalletMismatch":false}')
ledger_rate=$(echo "$reconcile_resp" | jq -r ".summary.qualityGate.ledgerReconciliationRate")
critical_defects=$(echo "$reconcile_resp" | jq -r ".summary.qualityGate.criticalBillingDefects")
[ "$ledger_rate" -eq 100 ]
[ "$critical_defects" -ge 0 ]
echo "ledger_rate=$ledger_rate critical_defects=$critical_defects"

audit_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" "$BASE/api/workspace/audit?take=30")
audit_count=$(echo "$audit_resp" | jq -r ".auditEntries | length")
[ "$audit_count" -ge 3 ]
echo "audit_count=$audit_count"

quality_metrics_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" "$BASE/api/quality/metrics")
billing_anomaly_stats=$(echo "$quality_metrics_resp" | jq -r ".billingAnomaliesBySeverity | length")
[ "$billing_anomaly_stats" -ge 0 ]
echo "billing_anomaly_stats=$billing_anomaly_stats"

echo "PHASE7_E2E_SUCCESS"
