#!/bin/bash
# ============================================================
# CanQuest — Cek DAR & Contract v21 Aktif di Participant (VPS 1)
#
# Auth: Keycloak client_credentials (scope=daml_ledger_api)
#       Sama persis seperti backend (KeycloakTokenService).
#
# CARA PAKAI (jalankan di VPS 1, atau mana saja yang bisa reach ledger):
#   export KEYCLOAK_URL="https://auth.canquestlabs.com"
#   export KEYCLOAK_REALM="canton"                          # realm Anda
#   export LEDGER_CLIENT_ID="validator-app-backend"         # dari .env backend
#   export LEDGER_CLIENT_SECRET="xxx"                       # dari .env backend
#   export LEDGER_API_URL="https://ledger.canquestlabs.com"
#   export OPERATOR_PARTY_ID="canquest-operator::..."      # opsional, utk filter
#
#   bash scripts/check-v21-active-contracts.sh
#
# Prereq: curl, jq
# Aman: READ-ONLY (GET packages + ACS query), tidak menyentuh ledger.
# ============================================================
set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-https://auth.canquestlabs.com}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-canton}"
LEDGER_CLIENT_ID="${LEDGER_CLIENT_ID:-}"
LEDGER_CLIENT_SECRET="${LEDGER_CLIENT_SECRET:-}"
LEDGER_API_URL="${LEDGER_API_URL:-https://ledger.canquestlabs.com}"
LEDGER_API_AUTH_SCOPE="${LEDGER_API_AUTH_SCOPE:-daml_ledger_api}"
OPERATOR_PARTY_ID="${OPERATOR_PARTY_ID:-}"

# ── Validasi env ─────────────────────────────────────────────
missing=()
[ -z "$LEDGER_CLIENT_ID" ]     && missing+=("LEDGER_CLIENT_ID")
[ -z "$LEDGER_CLIENT_SECRET" ] && missing+=("LEDGER_CLIENT_SECRET")
if [ ${#missing[@]} -gt 0 ]; then
  echo "❌ Env belum lengkap. Set dulu:"
  for m in "${missing[@]}"; do echo "   export $m=\"<nilai dari .env backend>\""; done
  echo ""
  echo "Ambil nilai LEDGER_CLIENT_ID / LEDGER_CLIENT_SECRET dari file .env backend"
  echo "(VPS 2, apps/api/.env)."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq belum terinstall. Install: sudo apt install jq"
  exit 1
fi

# ── 0. Ambil token dari Keycloak ─────────────────────────────
TOKEN_URL="${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"
echo ""
echo "▶ [0/4] Ambil token ledger dari Keycloak..."
echo "       POST $TOKEN_URL"
echo "       client_id=$LEDGER_CLIENT_ID  scope=$LEDGER_API_AUTH_SCOPE"
echo "--------------------------------------------------"

TOKEN_RESP=$(curl -s -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$LEDGER_CLIENT_ID" \
  -d "client_secret=$LEDGER_CLIENT_SECRET" \
  -d "scope=$LEDGER_API_AUTH_SCOPE" 2>&1) || {
    echo "❌ Gagal request token. Response:"
    echo "$TOKEN_RESP"
    exit 1
  }

TOKEN=$(echo "$TOKEN_RESP" | jq -r '.access_token // empty' 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
  echo "❌ Token kosong. Response Keycloak:"
  echo "$TOKEN_RESP" | jq . 2>/dev/null || echo "$TOKEN_RESP"
  exit 1
fi

echo "✅ Token dapat (expiry: $(echo "$TOKEN_RESP" | jq -r '.expires_in // "?"')s, len=${#TOKEN})"
echo ""

AUTH=(-H "Authorization: Bearer $TOKEN")

echo "=================================================="
echo " CanQuest — Cek DAR & Contract v21 Aktif"
echo " Ledger API : $LEDGER_API_URL"
echo " Operator   : ${OPERATOR_PARTY_ID:-(tidak difilter)}"
echo "=================================================="
echo ""

# ── 1. Daftar DAR ter-deploy di participant ──────────────────
echo "▶ [1/4] Daftar DAR ter-deploy di participant:"
echo "--------------------------------------------------"
DAR_LIST=$(curl -s "${AUTH[@]}" "$LEDGER_API_URL/v2/packages" 2>/dev/null || echo "[]")
if [ "$(echo "$DAR_LIST" | jq 'if type=="array" then length else 0 end' 2>/dev/null || echo 0)" -gt 0 ]; then
  echo "$DAR_LIST" | jq -r '.[]? | "  • \(.packageId[0:16])...  v\(.packageVersion // "?")  \(.sourceDescription // .packageName // "?")"' 2>/dev/null
else
  echo "  (kosong atau gagal parse). Raw:"
  echo "$DAR_LIST" | head -c 1000
fi

echo ""
echo "  Package canquest-v* yang ter-deploy:"
echo "$DAR_LIST" | jq -r '.[]? | select((.sourceDescription // .packageName // "") | test("canquest")) | "    ✅ \(.sourceDescription // .packageName) v\(.packageVersion) [id=\(.packageId[0:16])...]"' 2>/dev/null \
  || echo "  (tidak ada / tidak bisa parse)"
echo ""

# ── 2. Cek contract aktif per template v21 ───────────────────
echo "▶ [2/4] Contract v21 AKTIF di ledger (Active Contract Set):"
echo "--------------------------------------------------"

V21_TEMPLATES=(
  "WalletRegistration"
  "QuestCampaign"
  "QuestClaim"
)

# Build body ACS. Jika operator diset, tambahkan readAs (filter lebih ketat).
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

TOTAL_ACTIVE=0
for TPL in "${V21_TEMPLATES[@]}"; do
  ACS_RESP=$(curl -s "${AUTH[@]}" -X POST \
    "$LEDGER_API_URL/v2/state/active-contracts" \
    -H "Content-Type: application/json" \
    -d "$(build_acs_body)" 2>/dev/null || echo '{"results":[]}')

  COUNT=$(echo "$ACS_RESP" | jq --arg tpl "$TPL" \
    '[.results[]? | select(.templateId.value.name // .templateId // "" | endswith($TPL))] | length' 2>/dev/null || echo "?")

  printf "  %-22s : %s active\n" "$TPL" "$COUNT"
  if [ "$COUNT" != "?" ] && [ "$COUNT" -gt 0 ] 2>/dev/null; then
    TOTAL_ACTIVE=$((TOTAL_ACTIVE + COUNT))
  fi
done

echo ""
echo "  📊 TOTAL contract v21 aktif: $TOTAL_ACTIVE"
echo ""

# ── 3. Rekomendasi strategi ──────────────────────────────────
echo "▶ [3/4] Rekomendasi strategi migrasi:"
echo "--------------------------------------------------"
if [ "$TOTAL_ACTIVE" -eq 0 ]; then
  echo "  ✅ FRESH START — tidak ada contract v21 aktif."
  echo "     → Deploy canquest-v22 langsung (breaking change, rename package)."
  echo "     → Source v21 boleh dihapus dari repo (simpan DAR artifact utk audit)."
  echo "     → Unvet v21 opsional (tidak ada contract mengunci)."
else
  echo "  ⚠️  Ada $TOTAL_ACTIVE contract v21 aktif → ada 2 opsi:"
  echo "     A) FRESH START: biarkan v21 contract di ledger (audit-trail),"
  echo "        archive manual 1-per-1 kalau perlu. Workflow baru mulai di v22."
  echo "     B) MIGRASI: tambah choice Upgrade di v21 (archive → create v22),"
  echo "        jalankan backend automation iterasi ACS."
  echo ""
  echo "     Rekomendasi: kalau contract v21 cuma WalletRegistration (identitas),"
  echo "     fresh start aman — v22 create ulang identitas baru."
  echo "     Kalau ada QuestCampaign aktif dgn reward outstanding, settle dulu."
fi
echo ""

# ── 4. Pre-flight untuk deploy v22 ───────────────────────────
echo "▶ [4/4] Pre-flight deploy v22 (yang harus disiapkan):"
echo "--------------------------------------------------"
echo "  [ ] DAML SDK 3.4.11 ter-install (daml --version)"
echo "  [ ] Source canquest-v22 ditulis (packages/daml/daml/Main.daml + daml.yaml)"
echo "  [ ] daml build → .daml/dist/canquest-v22-1.0.0.dar"
echo "  [ ] Simpan DAR v21 artifact ke artifact repo (audit + rollback)"
echo "  [ ] Backend: ganti CANTON_DAML_PACKAGE_NAME=canquest-v22 (symbolic ref)"
echo "  [ ] Test di LocalNet/DevNet dulu sebelum MainNet"
echo ""
echo "Selesai. Bawa output ini ke ZCode untuk lanjut draft v22."
