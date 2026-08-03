#!/bin/bash
# ============================================================
# CanQuest — Dump semua Party ID + cek eksis di ledger
#
# Auto-baca apps/api/.env, tampilkan semua CANTON_*_PARTY_ID,
# lalu cek party eksis di participant via GET /v2/parties.
#
# CARA PAKAI (di VPS 2):
#   bash scripts/check-parties.sh
#   # (auto-load apps/api/.env)
#
# Prereq: curl, jq. READ-ONLY.
# ============================================================

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

# Auto-load credentials
LEDGER_CLIENT_ID="${LEDGER_CLIENT_ID:-$(load_env LEDGER_CLIENT_ID)}"
LEDGER_CLIENT_SECRET="${LEDGER_CLIENT_SECRET:-$(load_env LEDGER_CLIENT_SECRET)}"

echo ""
echo "=================================================="
echo " CanQuest — Party Inventory"
echo "=================================================="
[ -n "$ENV_FILE" ] && echo " .env         : $ENV_FILE" || echo " .env         : (tidak ditemukan)"
echo " Ledger       : $LEDGER_API_URL"
echo "=================================================="
echo ""

# ── 1. Dump semua party dari .env ────────────────────────────
echo "▶ [1/2] Party ID dari apps/api/.env:"
echo "--------------------------------------------------"

PARTY_KEYS=(
  "CANTON_OPERATOR_PARTY_ID:Operator (signer DAML)"
  "CANTON_VALIDATOR_PARTY_ID:Validator/DSO admin"
  "CANTON_DSO_PARTY_ID:DSO (admin Amulet)"
  "CANTON_REWARD_PARTY_ID:Reward wallet"
  "CANTON_FEE_RECIPIENT_PARTY_ID:Fee/treasury recipient"
  "CANTON_FEE_PARTY_ID:Fee party (alt)"
  "CANTON_LOCK_HOLDER_PARTY:Lock holder"
  "CANTON_APP_PROVIDER_PARTY_ID:App provider (FAR)"
)

PARTIES_FOUND=()
for entry in "${PARTY_KEYS[@]}"; do
  key="${entry%%:*}"
  label="${entry#*:}"
  val=$(load_env "$key")
  if [ -n "$val" ] && [ "$val" != "CHANGE_ME"* ] && [ "$val" != "TODO"* ]; then
    printf "  ✅ %-32s %s\n   %-32s %s\n" "$key" "$val" "" "($label)"
    PARTIES_FOUND+=("$val")
  else
    printf "  ⚠️  %-32s %s  (%s)\n" "$key" "${val:-(unset)}" "$label"
  fi
done
echo ""

# Token
if [ -z "$LEDGER_CLIENT_ID" ] || [ -z "$LEDGER_CLIENT_SECRET" ]; then
  echo "❌ Tidak bisa cek ledger (LEDGER_CLIENT_ID/SECRET kosong). Hanya dump .env."
  exit 0
fi

TOKEN_URL="${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"
TOKEN=$(curl -s -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$LEDGER_CLIENT_ID" \
  --data-urlencode "client_secret=$LEDGER_CLIENT_SECRET" \
  --data-urlencode "scope=daml_ledger_api" 2>/dev/null \
  | jq -r '.access_token // empty' 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "❌ Gagal ambil token Keycloak. Skip cek ledger."
  exit 0
fi

# ── 2. Cek party eksis di participant ────────────────────────
echo "▶ [2/2] Cek party eksis di participant (GET /v2/parties):"
echo "--------------------------------------------------"

for party in "${PARTIES_FOUND[@]}"; do
  [ -z "$party" ] && continue
  # Cek party by ID
  DETAIL=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$LEDGER_API_URL/v2/parties?parties=$party" 2>/dev/null)
  EXISTS=$(echo "$DETAIL" | jq -r --arg p "$party" \
    '.results[]? | select(.party == $p or .identity == $p) | .displayName // .party // "exists"' 2>/dev/null)

  if [ -n "$EXISTS" ]; then
    printf "  ✅ %-40s → %s\n" "${party:0:48}..." "terdaftar"
  else
    # Cek via response size
    SIZE=$(printf '%s' "$DETAIL" | wc -c)
    if [ "$SIZE" -lt 50 ]; then
      printf "  ❌ %-40s → tidak ditemukan\n" "${party:0:48}..."
    else
      printf "  ❓ %-40s → %s\n" "${party:0:48}..." "$(echo "$DETAIL" | head -c 80)"
    fi
  fi
done
echo ""

# ── 3. RewardDelegation relevance ────────────────────────────
echo "=================================================="
echo " CATATAN UNTUK DAML v22"
echo "=================================================="
echo " • DAML Settle choice akan nested-exercise 2 TransferFactory_Transfer:"
echo "     1) fee  : sender=user (atau appProvider bila FAR on)"
echo "     2) reward: sender=rewardParty"
echo " • actAs command minimal: [operator, user, rewardParty]"
echo " • RewardDelegation template (optional): rewardParty delegate ke operator,"
echo "   supaya rewardParty tidak perlu di actAs tiap Settle."
echo " • Cek CANTON_REWARD_PARTY_ID di atas — kalau SET, RewardDelegation optional;"
echo "   kalau UNSET (fallback validator), DAML perlu handling khusus."
echo "=================================================="
