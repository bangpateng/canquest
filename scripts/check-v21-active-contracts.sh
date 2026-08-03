#!/bin/bash
# ============================================================
# CanQuest — Cek DAR & Contract v21 Aktif (v2 — defensive)
#
# Auth: Keycloak client_credentials (scope=daml_ledger_api)
#
# Perubahan v2:
#   - Handle response /v2/packages format {packageIds: [...]} (Canton 3.3+)
#   - Resolve nama package via /v2/packages/{id} (detail per package)
#   - Tampilkan response mentah ACS untuk debug, bukan langsung parse count
#   - Auto-detect party dari token JWT (untuk readAs fallback)
#
# CARA PAKAI (di VPS 2):
#   export KEYCLOAK_URL="https://auth.canquestlabs.com"
#   export KEYCLOAK_REALM="canton"
#   export LEDGER_CLIENT_ID="validator-app-backend"
#   export LEDGER_CLIENT_SECRET="xxx"
#   export LEDGER_API_URL="https://ledger.canquestlabs.com"
#   export OPERATOR_PARTY_ID="canquest-operator::..."   # opsional
#
#   bash scripts/check-v21-active-contracts.sh
#
# Prereq: curl, jq, base64
# Aman: READ-ONLY.
# ============================================================
set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-https://auth.canquestlabs.com}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-canton}"
LEDGER_CLIENT_ID="${LEDGER_CLIENT_ID:-}"
LEDGER_CLIENT_SECRET="${LEDGER_CLIENT_SECRET:-}"
LEDGER_API_URL="${LEDGER_API_URL:-https://ledger.canquestlabs.com}"
LEDGER_API_AUTH_SCOPE="${LEDGER_API_AUTH_SCOPE:-daml_ledger_api}"
OPERATOR_PARTY_ID="${OPERATOR_PARTY_ID:-}"

missing=()
[ -z "$LEDGER_CLIENT_ID" ]     && missing+=("LEDGER_CLIENT_ID")
[ -z "$LEDGER_CLIENT_SECRET" ] && missing+=("LEDGER_CLIENT_SECRET")
if [ ${#missing[@]} -gt 0 ]; then
  echo "❌ Env belum lengkap:"
  for m in "${missing[@]}"; do echo "   export $m=\"<nilai>\""; done
  exit 1
fi

for cmd in curl jq base64; do
  command -v $cmd >/dev/null 2>&1 || { echo "❌ $cmd belum terinstall"; exit 1; }
done

# ── 0. Ambil token dari Keycloak ─────────────────────────────
TOKEN_URL="${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"
echo ""
echo "▶ [0/5] Ambil token ledger dari Keycloak..."
echo "       POST $TOKEN_URL (client_id=$LEDGER_CLIENT_ID, scope=$LEDGER_API_AUTH_SCOPE)"
echo "--------------------------------------------------"

TOKEN_RESP=$(curl -s -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$LEDGER_CLIENT_ID" \
  -d "client_secret=$LEDGER_CLIENT_SECRET" \
  -d "scope=$LEDGER_API_AUTH_SCOPE" 2>&1) || {
    echo "❌ Gagal request token. Response: $TOKEN_RESP"; exit 1; }

TOKEN=$(echo "$TOKEN_RESP" | jq -r '.access_token // empty' 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  echo "❌ Token kosong. Response Keycloak:"
  echo "$TOKEN_RESP" | jq . 2>/dev/null || echo "$TOKEN_RESP"
  exit 1
fi
echo "✅ Token dapat (len=${#TOKEN}, expires_in=$(echo "$TOKEN_RESP" | jq -r '.expires_in // "?"')s)"
echo ""

AUTH=(-H "Authorization: Bearer $TOKEN")

echo "=================================================="
echo " CanQuest — Cek DAR & Contract v21 Aktif"
echo " Ledger   : $LEDGER_API_URL"
echo " Operator : ${OPERATOR_PARTY_ID:-(tidak diset)}"
echo "=================================================="
echo ""

# ── 1. Daftar package IDs ter-deploy ─────────────────────────
echo "▶ [1/5] GET /v2/packages (raw response):"
echo "--------------------------------------------------"
PKG_RESP=$(curl -s "${AUTH[@]}" "$LEDGER_API_URL/v2/packages" 2>/dev/null || echo '{}')
echo "$PKG_RESP" | jq . 2>/dev/null || echo "$PKG_RESP"
echo ""

# Extract list ID. Handle 2 format: {packageIds:[...]} atau array langsung
PKG_IDS=$(echo "$PKG_RESP" | jq -r '
  if type == "array" then .[]
  elif .packageIds then .packageIds[]
  else empty end' 2>/dev/null)

PKG_COUNT=$(echo "$PKG_IDS" | grep -c . 2>/dev/null || echo 0)
echo "  Total package IDs: $PKG_COUNT"
echo ""

# ── 2. Resolve detail per package (cari canquest-v*) ─────────
echo "▶ [2/5] Resolve detail package (cari canquest-v*):"
echo "--------------------------------------------------"
CANQUEST_PACKAGES=""
CANQUEST_COUNT=0
if [ -n "$PKG_IDS" ]; then
  while IFS= read -r PID; do
    [ -z "$PID" ] && continue
    # GET detail per package
    DETAIL=$(curl -s "${AUTH[@]}" "$LEDGER_API_URL/v2/packages/$PID" 2>/dev/null || echo '{}')
    NAME=$(echo "$DETAIL" | jq -r '.sourcePackageName // .name // .packageName // "?"' 2>/dev/null)
    VERSION=$(echo "$DETAIL" | jq -r '.packageVersion // .version // "?"' 2>/dev/null)
    SRC=$(echo "$DETAIL" | jq -r '.sourceDescription // "-" ' 2>/dev/null)

    # Tandai kalau canquest
    if echo "$NAME $SRC" | grep -qi "canquest"; then
      echo "  ✅ canquest  $NAME v$VERSION  [id=${PID:0:16}...]  ($SRC)"
      CANQUEST_PACKAGES="$CANQUEST_PACKAGES $PID"
      CANQUEST_COUNT=$((CANQUEST_COUNT + 1))
    fi
  done <<< "$PKG_IDS"
fi

if [ "$CANQUEST_COUNT" -eq 0 ]; then
  echo "  ⚠️  Tidak ada package canquest-v* ditemukan via name match."
  echo "     (mungkin DAML Anda belum pernah sukses ter-deploy, atau"
  echo "      backend memanggil templateId tapi gagal diam-diam.)"
fi
echo ""
echo "  📊 Total package canquest ter-deploy: $CANQUEST_COUNT"
echo ""

# ── 3. Decode party dari token JWT (fallback readAs) ─────────
echo "▶ [3/5] Decode token JWT (cari party yang bisa read):"
echo "--------------------------------------------------"
JWT_PART=$(echo "$TOKEN" | cut -d'.' -f2)
# Pad base64 ke kelipatan 4
PAD=$(( (4 - ${#JWT_PART} % 4) % 4 ))
JWT_PART="${JWT_PART}$(printf '=%.0s' $(seq 1 $PAD))"
JWT_PAYLOAD=$(echo "$JWT_PART" | tr '_-' '/+' | base64 -d 2>/dev/null || echo '{}')

LEDGER_USER_ID=$(echo "$JWT_PAYLOAD" | jq -r '.sub // "?"')
TOKEN_PARTIES=$(echo "$JWT_PAYLOAD" | jq -r '(.act_as // .actAs // []) | join(",") // "?"')
echo "  Token sub (ledger user): $LEDGER_USER_ID"
echo "  Token act_as parties    : ${TOKEN_PARTIES:-(tidak ada)}"
echo ""

# ── 4. Query ACS — RAW dulu, baru parse ──────────────────────
echo "▶ [4/5] Query Active Contract Set (RAW response):"
echo "--------------------------------------------------"

# Coba 2 varian body: dengan readAs (kalau operator diset) atau filter any-party
build_acs_body() {
  if [ -n "$OPERATOR_PARTY_ID" ]; then
    jq -n --arg p "$OPERATOR_PARTY_ID" '{
      filter: [{ cumulative: [{ identifierFilter: { WildcardFilter: { value: {} } } }] }],
      readAs: [$p],
      verbose: true
    }'
  else
    jq -n '{
      filter: [{ cumulative: [{ identifierFilter: { WildcardFilter: { value: {} } } }] }],
      verbose: true
    }'
  fi
}

ACS_HTTP_CODE=$(curl -s -o /tmp/acs_resp.json -w "%{http_code}" "${AUTH[@]}" -X POST \
  "$LEDGER_API_URL/v2/state/active-contracts" \
  -H "Content-Type: application/json" \
  -d "$(build_acs_body)" 2>/dev/null || echo "000")

echo "  HTTP status: $ACS_HTTP_CODE"
echo "  Response (first 1500 chars):"
head -c 1500 /tmp/acs_resp.json
echo ""
echo "..."

if [ "$ACS_HTTP_CODE" != "200" ]; then
  echo ""
  echo "  ❌ ACS query gagal (HTTP $ACS_HTTP_CODE). Kemungkinan:"
  echo "     - Token tidak punya right CanReadAsAnyParty (butuh service-account)"
  echo "     - Filter body salah format"
  echo "     - Set OPERATOR_PARTY_ID dan coba lagi"
fi
echo ""

# ── 5. Parse count per template canquest ─────────────────────
echo "▶ [5/5] Hitung contract aktif per template canquest:"
echo "--------------------------------------------------"
V21_TEMPLATES=("WalletRegistration" "QuestCampaign" "QuestClaim")
TOTAL_ACTIVE=0
PARSE_OK="yes"

for TPL in "${V21_TEMPLATES[@]}"; do
  COUNT=$(jq --arg tpl "$TPL" \
    '[.results[]? | select((.templateId.value.name // .templateId // "") | endswith($tpl))] | length' \
    /tmp/acs_resp.json 2>/dev/null || echo "ERR")
  printf "  %-22s : %s\n" "$TPL" "$COUNT"
  if [ "$COUNT" = "ERR" ]; then PARSE_OK="no";
  elif [ "$COUNT" -gt 0 ] 2>/dev/null; then TOTAL_ACTIVE=$((TOTAL_ACTIVE + COUNT)); fi
done
echo ""
echo "  📊 TOTAL contract canquest aktif: $TOTAL_ACTIVE"
echo "  Parse sukses: $PARSE_OK"
echo ""

# ── Rekomendasi ──────────────────────────────────────────────
echo "=================================================="
echo " REKOMENDASI"
echo "=================================================="
if [ "$PARSE_OK" = "no" ]; then
  echo " ⚠️  Parse GAGAL — jangan ambil keputusan dulu."
  echo "     Lihat raw response ACS di atas. Kalau HTTP 200 tapi"
  echo "     results kosong → ledger benar-benar bersih (FRESH START)."
  echo "     Kalau HTTP ≠ 200 → masalah auth/rights, perlu service-account token."
  echo "     Paste raw response ini ke ZCode untuk analisis."
elif [ "$TOTAL_ACTIVE" -eq 0 ]; then
  echo " ✅ FRESH START — ledger bersih dari contract canquest aktif."
  echo "    → Bisa langsung draft canquest-v22."
  echo "    → DAR canquest lama (kalau ada) boleh dibiarkan / unvet opsional."
else
  echo " ⚠️  Ada $TOTAL_ACTIVE contract aktif. Baca raw response di atas"
  echo "    untuk detail tiap contract (cid, payload). Putuskan:"
  echo "    A) Fresh start (biarkan contract lama sebagai audit trail)"
  echo "    B) Archive manual sebelum deploy v22"
fi
echo ""
echo "Bawa OUTPUT INI (termasuk raw response) ke ZCode untuk lanjut."
