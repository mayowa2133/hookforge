#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
COOKIE_OWNER="/tmp/hookforge_e2e_enterprise_owner_cookie.txt"
COOKIE_MEMBER="/tmp/hookforge_e2e_enterprise_member_cookie.txt"
COOKIE_BLOCK="/tmp/hookforge_e2e_enterprise_block_cookie.txt"
OWNER_EMAIL="e2e_enterprise_owner_$(date +%s)@example.com"
MEMBER_EMAIL="e2e_enterprise_member_$(date +%s)@example.com"
PASSWORD="StrongPass123!"

rm -f "$COOKIE_OWNER" "$COOKIE_MEMBER" "$COOKIE_BLOCK"

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

login_user() {
  local cookie_file="$1"
  local email="$2"
  local workspace_slug="${3:-}"
  local payload
  if [ -n "$workspace_slug" ]; then
    payload=$(printf '{"email":"%s","password":"%s","workspaceSlug":"%s"}' "$email" "$PASSWORD" "$workspace_slug")
  else
    payload=$(printf '{"email":"%s","password":"%s"}' "$email" "$PASSWORD")
  fi
  curl -sS -o /tmp/hookforge_enterprise_login.json -w "%{http_code}" \
    -c "$cookie_file" -b "$cookie_file" \
    -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

register_user "$COOKIE_OWNER" "$OWNER_EMAIL"
register_user "$COOKIE_MEMBER" "$MEMBER_EMAIL"
echo "registered_owner=$OWNER_EMAIL registered_member=$MEMBER_EMAIL"

login_code=$(login_user "$COOKIE_OWNER" "$OWNER_EMAIL")
[ "$login_code" = "200" ]
echo "credentials_login_before_enforce=200"

policy_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" "$BASE/api/workspace/security/policy")
workspace_id=$(echo "$policy_resp" | jq -r ".workspaceId")
[ -n "$workspace_id" ] && [ "$workspace_id" != "null" ]
echo "workspace_id=$workspace_id"

provider_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/workspace/security/sso/providers" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: e2e-provider-$(date +%s)" \
  -H "x-workspace-id: $workspace_id" \
  -d '{"type":"OIDC","name":"E2E OIDC","issuerUrl":"https://idp.example.com","clientId":"hookforge-e2e","clientSecret":"secret-e2e","enabled":true}')
provider_id=$(echo "$provider_resp" | jq -r ".provider.id")
[ -n "$provider_id" ] && [ "$provider_id" != "null" ]
echo "provider_id=$provider_id"

policy_update_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/workspace/security/policy" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: e2e-policy-$(date +%s)" \
  -H "x-workspace-id: $workspace_id" \
  -d '{"enforceSso":true,"allowPasswordAuth":false,"sessionTtlHours":24,"requireMfa":false}')
enforce_sso=$(echo "$policy_update_resp" | jq -r ".policy.enforceSso")
allow_password=$(echo "$policy_update_resp" | jq -r ".policy.allowPasswordAuth")
[ "$enforce_sso" = "true" ]
[ "$allow_password" = "false" ]
echo "policy_enforced=true"

login_block_code=$(login_user "$COOKIE_BLOCK" "$OWNER_EMAIL")
[ "$login_block_code" = "403" ]
login_block_reason=$(jq -r ".code" /tmp/hookforge_enterprise_login.json)
[ "$login_block_reason" = "SSO_REQUIRED" ]
echo "credentials_blocked_by_sso=true"

invite_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/workspace/members" \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: $workspace_id" \
  -d "$(printf '{"email":"%s","role":"VIEWER"}' "$MEMBER_EMAIL")")
member_id=$(echo "$invite_resp" | jq -r ".member.id")
[ -n "$member_id" ] && [ "$member_id" != "null" ]
echo "member_invited=$member_id"

member_login_code=$(login_user "$COOKIE_MEMBER" "$MEMBER_EMAIL")
[ "$member_login_code" = "200" ]

member_policy_code=$(curl -sS -o /tmp/hookforge_enterprise_member_policy.json -w "%{http_code}" \
  -c "$COOKIE_MEMBER" -b "$COOKIE_MEMBER" \
  -X POST "$BASE/api/workspace/security/policy" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: e2e-member-policy-$(date +%s)" \
  -H "x-workspace-id: $workspace_id" \
  -d '{"sessionTtlHours":36}')
[ "$member_policy_code" = "401" ] || [ "$member_policy_code" = "403" ]
echo "capability_guard_rejection=$member_policy_code"

create_key_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/public-api-keys" \
  -H "Content-Type: application/json" \
  -H "x-workspace-id: $workspace_id" \
  -d '{"name":"Enterprise E2E Key","scopes":["translate.read"]}')
api_key_id=$(echo "$create_key_resp" | jq -r ".apiKey.id")
api_key_secret=$(echo "$create_key_resp" | jq -r ".secret")
[ -n "$api_key_id" ] && [ "$api_key_id" != "null" ]
[ -n "$api_key_secret" ] && [ "$api_key_secret" != "null" ]

scope_denied_code=$(curl -sS -o /tmp/hookforge_enterprise_scope_denied.json -w "%{http_code}" \
  -H "Authorization: Bearer $api_key_secret" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/api/public/v1/translate/submit" \
  -d '{"sourceMediaUrl":"https://example.com/source.mp4","sourceLanguage":"en","targetLanguages":["es"],"lipDub":false}')
[ "$scope_denied_code" = "403" ]
echo "scope_denied=true"

scope_update_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/public-api-keys/$api_key_id/scopes" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: e2e-scopes-$(date +%s)" \
  -H "x-workspace-id: $workspace_id" \
  -d '{"scopes":["translate.read","translate.submit","translate.status","translate.estimate"]}')
scope_count=$(echo "$scope_update_resp" | jq -r ".apiKey.scopes | length")
[ "$scope_count" -ge 4 ]

rotate_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/public-api-keys/$api_key_id/rotate" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: e2e-rotate-$(date +%s)" \
  -H "x-workspace-id: $workspace_id" \
  -d '{"overlapMinutes":10}')
rotated_secret=$(echo "$rotate_resp" | jq -r ".secret")
[ -n "$rotated_secret" ] && [ "$rotated_secret" != "null" ]
echo "api_key_rotated=true"

submit_code=$(curl -sS -o /tmp/hookforge_enterprise_submit.json -w "%{http_code}" \
  -H "Authorization: Bearer $rotated_secret" \
  -H "Content-Type: application/json" \
  -X POST "$BASE/api/public/v1/translate/submit" \
  -d '{"sourceMediaUrl":"https://example.com/source.mp4","sourceLanguage":"en","targetLanguages":["es"],"lipDub":false}')
[ "$submit_code" = "202" ]
echo "scoped_submit_ok=true"

audit_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  "$BASE/api/workspace/audit/events?take=50" \
  -H "x-workspace-id: $workspace_id")
policy_audit_count=$(echo "$audit_resp" | jq '[.events[] | select(.action=="workspace_security_policy_update")] | length')
key_audit_count=$(echo "$audit_resp" | jq '[.events[] | select(.action=="api_key_rotate" or .action=="api_key_scopes_update")] | length')
[ "$policy_audit_count" -ge 1 ]
[ "$key_audit_count" -ge 1 ]
echo "audit_events_validated=true"

ops_slo_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  "$BASE/api/ops/slo/summary?windowHours=24" \
  -H "x-workspace-id: $workspace_id")
render_total=$(echo "$ops_slo_resp" | jq -r ".summary.render.total")
ai_total=$(echo "$ops_slo_resp" | jq -r ".summary.ai.total")
[ "$render_total" -ge 0 ]
[ "$ai_total" -ge 0 ]

ops_queue_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  "$BASE/api/ops/queues/health" \
  -H "x-workspace-id: $workspace_id")
queue_count=$(echo "$ops_queue_resp" | jq -r ".queues | length")
[ "$queue_count" -ge 5 ]

backup_verify_resp=$(curl -sS -c "$COOKIE_OWNER" -b "$COOKIE_OWNER" \
  -X POST "$BASE/api/ops/recovery/backup-verify" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: e2e-backup-verify-$(date +%s)" \
  -H "x-workspace-id: $workspace_id" \
  -d '{"includeStorageProbe":true}')
backup_checks=$(echo "$backup_verify_resp" | jq -r ".checks | length")
[ "$backup_checks" -ge 2 ]
echo "ops_endpoints_validated=true"

echo "ENTERPRISE_E2E_SUCCESS"
