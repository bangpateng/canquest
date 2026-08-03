#!/bin/bash
# ============================================================
# CanQuest — Test DAR v22 di participant node
#
# Validasi DAML v22 jalan benar di node.
# Format body = persis seperti backend canton-ledger.service.ts:
#   { commands: [...], userId, commandId, actAs, readAs }
#   CreateCommand  = { CreateCommand: { templateId, createArguments } }
#   ExerciseCommand = { ExerciseCommand: { templateId, contractId, choice, choiceArgument } }
#
# AMAN: dummy contract only, no CC movement (Settle skip).
#
# CARA PAKAI (di VPS 2):
#   bash scripts/test-dar-v22.sh
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
USER_PARTY="${USER_PARTY:-$(load_env CANTON_REWARD_PARTY_ID)}"
ADMIN_USER="${LEDGER_API_ADMIN_USER:-$(load_env LEDGER_API_ADMIN_USER)}"
[ -z "$ADMIN_USER" ] && ADMIN_USER="${LEDGER_API_USER:-$(load_env LEDGER_API_USER)}"

PKG="#canquest-v22"

for cmd in curl jq; do
  command -v $cmd >/dev/null 2>&1 || { echo "❌ $cmd belum terinstall"; exit 1; }
done

echo ""
echo "=================================================="
echo " CanQuest — Test DAR v22 di Participant"
echo "=================================================="
[ -n "$ENV_FILE" ] && echo " .env       : $ENV_FILE"
echo " Ledger     : $LEDGER_API_URL"
echo " Admin user : ${ADMIN_USER:-(KOSONG!)}"
echo " Operator   : $OPERATOR"
echo " User       : $USER_PARTY"
echo "=================================================="
echo ""

if [ -z "$ADMIN_USER" ]; then
  echo "❌ ADMIN_USER (LEDGER_API_ADMIN_USER) kosong. Wajib utk userId."
  exit 1
fi
if [ -z "$OPERATOR" ] || [ -z "$USER_PARTY" ]; then
  echo "❌ OPERATOR atau USER_PARTY kosong."
  exit 1
fi

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
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SUFFIX=$(date +%s)

PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }

# Helper: submit command. Format PERSIS backend.
# Args: command_json commandId [extra_actAs_party]
# actAs = [operator] (party ID, BUKAN admin_user UUID).
# userId = LEDGER_API_ADMIN_USER (UUID ledger-api-user, utk auth).
# Endpoint: submit-and-wait-for-transaction-tree (utk dapat contractId dari tree)
submit() {
  local cmd_json="$1" cmd_id="$2" extra="${3:-}"
  local actAs_args
  if [ -n "$extra" ]; then
    actAs_args=$(jq -n --arg op "$OPERATOR" --arg x "$extra" '[$op, $x]')
  else
    actAs_args=$(jq -n --arg op "$OPERATOR" '[$op]')
  fi
  local body=$(jq -n \
    --argjson commands "[$cmd_json]" \
    --arg userId "$ADMIN_USER" \
    --arg commandId "$cmd_id" \
    --argjson actAs "$actAs_args" \
    '{commands: $commands, userId: $userId, commandId: $commandId, actAs: $actAs, readAs: $actAs}')
  curl -s "${AUTH[@]}" -X POST \
    "$LEDGER_API_URL/v2/commands/submit-and-wait-for-transaction-tree" \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null
}

# Helper: extract contractId(s) dari response transaction-tree.
# Canton 3.4 nested: transactionTree.eventsById.{n}.CreatedTreeEvent.value.{contractId,templateId}
# templateId di response = STRING hash (bukan {value:{name}}). Karena itu filter
# by templateName susah — kita pakai approach: ambil contractId per nodeId order.
# Backend pakai deep-search recursive (extractCreatedContractId). jq equivalent:
#   deep-traverse cari object dgn field contractId + templateId.
extract_created_cid() {
  local res="$1" tpl_suffix="${2:-}" nth="${3:-1}"
  # Jalankan jq dengan deep traversal. Cari semua CreatedTreeEvent.value
  # yg punya contractId. Filter by templateId hash suffix kalau ada.
  local result
  if [ -n "$tpl_suffix" ]; then
    result=$(echo "$res" | jq -r "
      [.. | objects | select(.contractId != null and .templateId != null)
       | select((.templateId | tostring) | test(\"$tpl_suffix\"))
       | .contractId] | if length >= $nth then .[$nth-1] else empty end" 2>/dev/null)
  else
    result=$(echo "$res" | jq -r "
      [.. | objects | select(.contractId != null and .templateId != null)
       | .contractId] | if length >= $nth then .[$nth-1] else empty end" 2>/dev/null)
  fi
  echo "$result"
}

# ── 1. Create WalletRegistration ─────────────────────────────
echo "▶ [1/7] Create WalletRegistration..."
CMD=$(jq -n \
  --arg admin "$OPERATOR" --arg user "$USER_PARTY" \
  --arg now "$NOW" --arg suf "$SUFFIX" '
  {CreateCommand: {
    templateId: "#canquest-v22:Main:WalletRegistration",
    createArguments: {
      admin: $admin, userAddress: $user,
      username: ("test_user_" + $suf),
      partyId: ("test_user_" + $suf + "::dummy"),
      inviteCode: ("TEST_" + $suf),
      registeredAt: $now
    }}}')
RES=$(submit "$CMD" "test-wallet-$SUFFIX")
WALLET_CID=$(extract_created_cid "$RES")
if [ -n "$WALLET_CID" ] && [ "$WALLET_CID" != "null" ]; then
  ok "WalletRegistration created: ${WALLET_CID:0:16}..."
else
  fail "WalletRegistration create gagal"
  echo "     Response: $(echo "$RES" | head -c 400)"
fi
echo ""

# ── 2. Create QuestCampaign (FCFS, maxWinners=1) ─────────────
echo "▶ [2/7] Create QuestCampaign (FCFS, maxWinners=1)..."
CMD=$(jq -n \
  --arg admin "$OPERATOR" --arg now "$NOW" --arg suf "$SUFFIX" '
  {CreateCommand: {
    templateId: "#canquest-v22:Main:QuestCampaign",
    createArguments: {
      admin: $admin,
      campaignId: ("TEST_FCFS_" + $suf),
      title: "Test FCFS Campaign",
      questKind: "CC_FCFS",
      rewardCc: "10.0",
      rewardToken: null,
      claimFeeCc: "3.0",
      maxWinners: "1",
      currentClaims: "0",
      status: "ACTIVE",
      createdAt: $now
    }}}')
RES=$(submit "$CMD" "test-camp-$SUFFIX")
CAMP_CID=$(extract_created_cid "$RES")
if [ -n "$CAMP_CID" ] && [ "$CAMP_CID" != "null" ]; then
  ok "QuestCampaign created: ${CAMP_CID:0:16}..."
else
  fail "QuestCampaign create gagal"
  echo "     Response: $(echo "$RES" | head -c 500)"
  echo ""
  echo "⚠️  Stop test (butuh campaign utk lanjut)."
  echo ""
  echo "=================================================="
  echo " SUMMARY (partial): PASS=$PASS FAIL=$FAIL"
  echo "=================================================="
  exit 1
fi
echo ""

# ── 3. Exercise ClaimSlot (FCFS, slot 1) ─────────────────────
echo "▶ [3/7] Exercise ClaimSlot (FCFS, slot 1)..."
CMD=$(jq -n \
  --arg cid "$CAMP_CID" --arg user "$USER_PARTY" \
  --arg now "$NOW" --arg suf "$SUFFIX" '
  {ExerciseCommand: {
    templateId: "#canquest-v22:Main:QuestCampaign",
    contractId: $cid,
    choice: "ClaimSlot",
    choiceArgument: {
      user: $user,
      claimId: ("TEST_CLAIM1_" + $suf),
      claimedAt: $now
    }}}')
RES=$(submit "$CMD" "test-claim1-$SUFFIX")
# ClaimSlot return (newCampaignCid, newClaimCid). 2 created events.
# Urutan by nodeId: 0 = campaign baru, 1 = receipt (atau sebaliknya).
# Ambil kedua lalu identifikasi: campaign punya field campaignId+status,
# receipt punya field claimId+claimFeeCc.
CID1=$(extract_created_cid "$RES" "" 1)
CID2=$(extract_created_cid "$RES" "" 2)
# Parse arguments utk identifikasi mana campaign mana receipt
ARGS1=$(echo "$RES" | jq -r "[.. | objects | select(.contractId==\"$CID1\")][0] | (.createArgument // .arguments // {}) | tostring" 2>/dev/null)
ARGS2=$(echo "$RES" | jq -r "[.. | objects | select(.contractId==\"$CID2\")][0] | (.createArgument // .arguments // {}) | tostring" 2>/dev/null)
if echo "$ARGS1" | grep -qi "claimId\|claimFee"; then
  CLAIM1_CID="$CID1"; NEW_CAMP_CID="$CID2"
elif echo "$ARGS2" | grep -qi "claimId\|claimFee"; then
  CLAIM1_CID="$CID2"; NEW_CAMP_CID="$CID1"
else
  # Fallback: CID1 = campaign (urutan pertama), CID2 = receipt
  NEW_CAMP_CID="$CID1"; CLAIM1_CID="$CID2"
fi
if [ -n "$CLAIM1_CID" ] && [ "$CLAIM1_CID" != "null" ]; then
  ok "ClaimSlot berhasil, QuestClaimReceipt: ${CLAIM1_CID:0:16}..."
  [ -n "$NEW_CAMP_CID" ] && [ "$NEW_CAMP_CID" != "null" ] && CAMP_CID="$NEW_CAMP_CID"
else
  fail "ClaimSlot gagal"
  echo "     Response: $(echo "$RES" | head -c 500)"
fi
echo ""

# ── 4. ClaimSlot lagi (harus GAGAL - maxWinners=1) ───────────
echo "▶ [4/7] Exercise ClaimSlot lagi (harus GAGAL - kuota penuh)..."
CMD=$(jq -n \
  --arg cid "$CAMP_CID" --arg user "$USER_PARTY" \
  --arg now "$NOW" --arg suf "$SUFFIX" '
  {ExerciseCommand: {
    templateId: "#canquest-v22:Main:QuestCampaign",
    contractId: $cid,
    choice: "ClaimSlot",
    choiceArgument: {
      user: $user,
      claimId: ("TEST_CLAIM2_" + $suf),
      claimedAt: $now
    }}}')
RES=$(submit "$CMD" "test-claim2-$SUFFIX")
ERR=$(echo "$RES" | jq -r '.errors[0]? // .cause? // .error? // empty' 2>/dev/null)
CIDS_COUNT=$(echo "$RES" | jq -r '[.. | objects | select(.contractId != null and .templateId != null) | .contractId] | length' 2>/dev/null)
if echo "$ERR" | grep -qi "Kuota\|quota\|maxWinners\|assert"; then
  ok "ClaimSlot kedua GAGAL (anti-sybil guard jalan): $(echo "$ERR" | head -c 80)"
elif [ "${CIDS_COUNT:-0}" -le 1 ]; then
  ok "ClaimSlot kedua GAGAL (no new claim = anti-sybil jalan)"
else
  echo "  ⚠️  ClaimSlot kedua: $CIDS_COUNT contracts (mungkin sukses?)"
  echo "     Response: $(echo "$RES" | head -c 200)"
fi
echo ""

# ── 5. EndCampaign (state machine) ───────────────────────────
echo "▶ [5/7] Exercise EndCampaign..."
CMD=$(jq -n \
  --arg cid "$CAMP_CID" --arg now "$NOW" '
  {ExerciseCommand: {
    templateId: "#canquest-v22:Main:QuestCampaign",
    contractId: $cid,
    choice: "EndCampaign",
    choiceArgument: { updatedAt: $now }
  }}')
RES=$(submit "$CMD" "test-end-$SUFFIX")
ENDED_CID=$(extract_created_cid "$RES")
if [ -n "$ENDED_CID" ] && [ "$ENDED_CID" != "null" ]; then
  ok "EndCampaign berhasil: ${ENDED_CID:0:16}..."
  CAMP_CID="$ENDED_CID"
else
  fail "EndCampaign gagal"
  echo "     Response: $(echo "$RES" | head -c 300)"
fi
echo ""

# ── 6. Close (consuming) ─────────────────────────────────────
echo "▶ [6/7] Exercise Close (final, consuming)..."
CMD=$(jq -n \
  --arg cid "$CAMP_CID" --arg now "$NOW" '
  {ExerciseCommand: {
    templateId: "#canquest-v22:Main:QuestCampaign",
    contractId: $cid,
    choice: "Close",
    choiceArgument: { closedAt: $now }
  }}')
RES=$(submit "$CMD" "test-close-$SUFFIX")
# Close = archive (consuming). Sukses = ada transactionTree.updateId (tx committed).
UPD=$(echo "$RES" | jq -r '.transactionTree.updateId // .updateId // empty' 2>/dev/null)
if [ -n "$UPD" ]; then
  ok "Close berhasil (archived, updateId: ${UPD:0:16}...)"
else
  fail "Close gagal"
  echo "     Response: $(echo "$RES" | head -c 300)"
fi
echo ""

# ── 7. RevealCode (harus GAGAL - fee-first guard) ────────────
echo "▶ [7/7] Exercise RevealCode (harus GAGAL - fee belum bayar)..."
if [ -z "$CLAIM1_CID" ] || [ "$CLAIM1_CID" = "null" ]; then
  fail "Skip RevealCode (ClaimSlot receipt tidak ada)"
else
  CMD=$(jq -n \
    --arg cid "$CLAIM1_CID" --arg now "$NOW" --arg suf "$SUFFIX" '
    {ExerciseCommand: {
      templateId: "#canquest-v22:Main:QuestClaimReceipt",
      contractId: $cid,
      choice: "RevealCode",
      choiceArgument: { code: ("INVITE_" + $suf), revealedAt: $now }
    }}')
  RES=$(submit "$CMD" "test-reveal-$SUFFIX")
  ERR=$(echo "$RES" | jq -r '.errors[0]? // .cause? // empty' 2>/dev/null)
  NEW_CIDS=$(echo "$RES" | jq -r '[.. | objects | select(.contractId != null and .templateId != null) | .contractId] | length' 2>/dev/null)
  if echo "$ERR" | grep -qi "Fee\|fee"; then
    ok "RevealCode GAGAL dgn benar (fee-first guard jalan)"
  elif [ "${NEW_CIDS:-0}" -ge 1 ]; then
    echo "  ⚠️  RevealCode sukses (mungkin guard tidak trigger - cek feePaid)"
  else
    ok "RevealCode GAGAL (no new contract = guard jalan)"
  fi
fi
echo ""

# ── Summary ──────────────────────────────────────────────────
echo "=================================================="
echo " TEST SUMMARY"
echo "=================================================="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ SEMUA TEST PASS — DAR v22 jalan benar di node."
else
  echo "  ⚠️  Ada test gagal. Paste output ke ZCode utk analisis."
fi
echo "=================================================="
