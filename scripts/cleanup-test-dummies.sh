#!/bin/bash
# ============================================================
# CanQuest — Cleanup contract test dummy dari participant
#
# Archive semua contract test dgn identifier match TEST_/test_/
# yg di-create dari scripts/test-dar-v22.sh.
#
# Strategi: query ACS utk QuestCampaign + QuestClaimReceipt +
# WalletRegistration, filter by campaignId/claimId/username match
# test pattern, lalu archive via consuming choice.
#
# AMAN: hanya archive contract dgn identifier test. Tidak sentuh
# contract production (yg akan ada setelah backend switch ke v22).
#
# CARA PAKAI (di VPS 2):
#   bash scripts/cleanup-test-dummies.sh
# ============================================================
set -uo pipefail

LEDGER_API_URL="${LEDGER_API_URL:-https://ledger.canquestlabs.com}"
KEYCLOAK_URL="${KEYCLOAK_URL:-https://auth.canquestlabs.com}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-canton}"

ENV_FILE=""
for candidate in "/var/www/canquest/apps/api/.env" "./apps/api/.env" "../apps/api/.env"; do
  [ -f "$candidate" ] && { ENV_FILE="$candidate"; break; }
done

load_env() {
  local key="$1"
  [ -n "$ENV_FILE" ] || return 1
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'"
}

LEDGER_CLIENT_ID="${LEDGER_CLIENT_ID:-$(load_env LEDGER_CLIENT_ID)}"
LEDGER_CLIENT_SECRET="${LEDGER_CLIENT_SECRET:-$(load_env LEDGER_CLIENT_SECRET)}"
OPERATOR="${OPERATOR_PARTY_ID:-$(load_env CANTON_OPERATOR_PARTY_ID)}"
ADMIN_USER="${LEDGER_API_ADMIN_USER:-$(load_env LEDGER_API_ADMIN_USER)}"
[ -z "$ADMIN_USER" ] && ADMIN_USER="${LEDGER_API_USER:-$(load_env LEDGER_API_USER)}"

for cmd in curl jq; do
  command -v $cmd >/dev/null 2>&1 || { echo "❌ $cmd belum terinstall"; exit 1; }
done

echo ""
echo "=================================================="
echo " CanQuest — Cleanup Test Dummy Contracts"
echo "=================================================="
[ -n "$ENV_FILE" ] && echo " .env       : $ENV_FILE"
echo " Ledger     : $LEDGER_API_URL"
echo " Operator   : $OPERATOR"
echo "=================================================="
echo ""

# Token
TOKEN_URL="${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"
TOKEN=$(curl -s -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$LEDGER_CLIENT_ID" \
  --data-urlencode "client_secret=$LEDGER_CLIENT_SECRET" \
  --data-urlencode "scope=daml_ledger_api" 2>/dev/null \
  | jq -r '.access_token // empty' 2>/dev/null)
[ -z "$TOKEN" ] && { echo "❌ Token kosong"; exit 1; }
echo "✅ Token dapat"
echo ""

AUTH=(-H "Authorization: Bearer $TOKEN")

# Helper: dapat offset ledgerEnd
get_offset() {
  curl -s "${AUTH[@]}" "$LEDGER_API_URL/v2/state/ledger-end" 2>/dev/null \
    | jq -r '.offset // 0' 2>/dev/null
}

# Helper: query ACS by template, return list of {contractId, createArgument}
# Args: templateId
query_acs() {
  local tpl_id="$1"
  local offset=$(get_offset)
  local body=$(jq -n \
    --arg op "$OPERATOR" \
    --arg tpl "$tpl_id" \
    --argjson offset "$offset" '
    {
      eventFormat: {
        filtersByParty: {
          ($op): {
            cumulative: [{
              identifierFilter: {
                TemplateFilter: {
                  value: { templateId: $tpl, includeCreatedEventBlob: true }
                }
              }
            }]
          }
        },
        verbose: false
      },
      activeAtOffset: $offset
    }')
  curl -s "${AUTH[@]}" -X POST \
    "$LEDGER_API_URL/v2/state/active-contracts" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null \
    | jq -c '[.. | objects
      | (.createArgument // .CreatedTreeEvent.createArgument // .CreatedEvent.createArgument // empty) as $args
      | select($args != null)
      | {contractId: (.contractId // .CreatedTreeEvent.contractId // .CreatedEvent.contractId // empty), args: $args}
      | select(.contractId != null and .contractId != "")]' 2>/dev/null
}

# Helper: archive via consuming choice
# Args: contractId templateId choiceName choiceArg
archive_contract() {
  local cid="$1" tpl="$2" choice="$3" arg_json="$4" label="$5"
  local now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local cmd=$(jq -n \
    --arg c "$cid" --arg t "$tpl" --arg ch "$choice" \
    --argjson arg "$arg_json" \
    '{ExerciseCommand: {templateId: $t, contractId: $c, choice: $ch, choiceArgument: $arg}}')
  local body=$(jq -n \
    --argjson commands "[$cmd]" \
    --arg userId "$ADMIN_USER" \
    --arg commandId "cleanup-$cid-${RANDOM}" \
    --argjson actAs "[\"$OPERATOR\"]" \
    '{commands: $commands, userId: $userId, commandId: $commandId, actAs: $actAs, readAs: $actAs}')
  local res=$(curl -s "${AUTH[@]}" -X POST \
    "$LEDGER_API_URL/v2/commands/submit-and-wait-for-transaction-tree" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null)
  local upd=$(echo "$res" | jq -r '.transactionTree.updateId // .updateId // empty' 2>/dev/null)
  if [ -n "$upd" ]; then
    echo "  🗑️  Archived $label: ${cid:0:16}..."
    return 0
  else
    echo "  ⚠️  Archive gagal $label (${cid:0:16}): $(echo "$res" | head -c 150)"
    return 1
  fi
}

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TOTAL=0
ARCHIVED=0

# ── 1. QuestCampaign test (Close) ────────────────────────────
echo "▶ [1/3] Cari + archive QuestCampaign test (Close)..."
CAMP_LIST=$(query_acs "#canquest-v22:Main:QuestCampaign")
# Filter: campaignId TEST_ + status ACTIVE/ENDED. Output tab-separated cid<TAB>status.
CAMP_TEST_TABS=$(echo "$CAMP_LIST" | jq -r '
  .[] | select(.args.campaignId // "" | test("^TEST_"))
  | select(.args.status == "ACTIVE" or .args.status == "ENDED")
  | [.contractId, .args.status] | @tsv' 2>/dev/null)
CAMP_COUNT=$(printf '%s\n' "$CAMP_TEST_TABS" | grep -c . 2>/dev/null || echo 0)
echo "   Ditemukan: $CAMP_COUNT QuestCampaign dgn campaignId TEST_* (ACTIVE/ENDED)"
TOTAL=$((TOTAL + CAMP_COUNT))
while IFS=$'\t' read -r cid status; do
  [ -z "$cid" ] && continue
  archive_contract "$cid" "#canquest-v22:Main:QuestCampaign" "Close" "{\"closedAt\":\"$NOW\"}" "QuestCampaign TEST ($status)" \
    && ARCHIVED=$((ARCHIVED + 1))
done <<< "$CAMP_TEST_TABS"
echo ""

# ── 2. QuestClaimReceipt test (Expire) ───────────────────────
echo "▶ [2/3] Cari + archive QuestClaimReceipt test (Expire)..."
RCPT_LIST=$(query_acs "#canquest-v22:Main:QuestClaimReceipt")
# Filter: claimId TEST_CLAIM + status PRE_SETTLE. Output tab-separated.
RCPT_TEST_TABS=$(echo "$RCPT_LIST" | jq -r '
  .[] | select(.args.claimId // "" | test("^TEST_CLAIM"))
  | select(.args.status == "PRE_SETTLE")
  | [.contractId, .args.status] | @tsv' 2>/dev/null)
RCPT_COUNT=$(printf '%s\n' "$RCPT_TEST_TABS" | grep -c . 2>/dev/null || echo 0)
echo "   Ditemukan: $RCPT_COUNT QuestClaimReceipt dgn claimId TEST_CLAIM* (PRE_SETTLE)"
TOTAL=$((TOTAL + RCPT_COUNT))
while IFS=$'\t' read -r cid status; do
  [ -z "$cid" ] && continue
  archive_contract "$cid" "#canquest-v22:Main:QuestClaimReceipt" "Expire" "{\"expiredAt\":\"$NOW\"}" "QuestClaimReceipt TEST" \
    && ARCHIVED=$((ARCHIVED + 1))
done <<< "$RCPT_TEST_TABS"
echo ""

# ── 3. WalletRegistration test ───────────────────────────────
echo "▶ [3/3] WalletRegistration test (tidak ada consuming choice - skip)"
echo "   WalletRegistration create-only, tidak bisa di-archive via choice."
echo "   Contract tetap di ACS sebagai audit trail (tidak ganggu production)."
echo ""

# ── Summary ──────────────────────────────────────────────────
echo "=================================================="
echo " CLEANUP SUMMARY"
echo "=================================================="
echo "  Total test contracts found : $TOTAL"
echo "  Successfully archived      : $ARCHIVED"
echo ""
if [ "$ARCHIVED" -eq "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
  echo "  ✅ Semua test contract archived. Ledger bersih."
elif [ "$TOTAL" -eq 0 ]; then
  echo "  ✅ Tidak ada test contract. Ledger sudah bersih."
else
  echo "  ⚠️  Ada contract belum ter-archived. Mungkin status bukan ACTIVE/PRE_SETTLE."
  echo "     (WalletRegistration tidak bisa di-archive — design DAML create-only)"
fi
echo "=================================================="
echo ""
echo "Note: WalletRegistration test tetap di ACS (create-only, no archive choice)."
echo "Tidak ganggu production krn dapp belum switch ke v22."
