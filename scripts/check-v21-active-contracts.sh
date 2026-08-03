#!/bin/bash
# ============================================================
# CanQuest — Cek Contract v21 Aktif (v3 — simpel & robust)
#
# v3 changes (vs v2):
#   - HAPUS loop 123-curl untuk resolve nama package (penyebab crash v2)
#   - Cukup 1x query ACS, ekstrak semua template name + count
#   - jq path BENAR: .templateId.value.name (object, bukan string)
#     -- ini bug v1/v2 yang bikin count = "?" (parse gagal)
#   - Tidak ada set -e yang bikin warning abort script
#
# CARA PAKAI (di VPS 2):
#   export LEDGER_CLIENT_ID="<dari .env>"
#   export LEDGER_CLIENT_SECRET="<dari .env>"
#   bash scripts/check-v21-active-contracts.sh
#
# Prereq: curl, jq. READ-ONLY.
# ============================================================

KEYCLOAK_URL="${KEYCLOAK_URL:-https://auth.canquestlabs.com}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-canton}"
LEDGER_CLIENT_ID="${LEDGER_CLIENT_ID:?LEDGER_CLIENT_ID harus diset}"
LEDGER_CLIENT_SECRET="${LEDGER_CLIENT_SECRET:?LEDGER_CLIENT_SECRET harus diset}"
LEDGER_API_URL="${LEDGER_API_URL:-https://ledger.canquestlabs.com}"
LEDGER_API_AUTH_SCOPE="${LEDGER_API_AUTH_SCOPE:-daml_ledger_api}"
OPERATOR_PARTY_ID="${OPERATOR_PARTY_ID:-}"

command -v jq   >/dev/null 2>&1 || { echo "❌ jq belum terinstall"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "❌ curl belum terinstall"; exit 1; }

# ── 0. Token Keycloak ────────────────────────────────────────
TOKEN_URL="${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"
echo ""
echo "▶ [0/4] Ambil token ledger dari Keycloak..."
echo "       POST $TOKEN_URL (client_id=$LEDGER_CLIENT_ID)"
echo "--------------------------------------------------"
TOKEN_RESP=$(curl -s -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$LEDGER_CLIENT_ID" \
  --data-urlencode "client_secret=$LEDGER_CLIENT_SECRET" \
  --data-urlencode "scope=$LEDGER_API_AUTH_SCOPE" 2>&1) || { echo "❌ curl gagal: $TOKEN_RESP"; exit 1; }

TOKEN=$(printf '%s' "$TOKEN_RESP" | jq -r '.access_token // empty' 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "❌ Token kosong. Response Keycloak:"
  printf '%s' "$TOKEN_RESP" | jq . 2>/dev/null || printf '%s\n' "$TOKEN_RESP"
  exit 1
fi
echo "✅ Token dapat (len=${#TOKEN}, expires_in=$(printf '%s' "$TOKEN_RESP" | jq -r '.expires_in // "?'"')s)"
echo ""

AUTH=(-H "Authorization: Bearer $TOKEN")

echo "=================================================="
echo " CanQuest — Cek Contract Aktif"
echo " Ledger   : $LEDGER_API_URL"
echo " Operator : ${OPERATOR_PARTY_ID:-(tidak diset)}"
echo "=================================================="
echo ""

# ── 1. Query ACS — 1x request, ambil semua contract ─────────
echo "▶ [1/4] Query Active Contract Set (semua template):"
echo "--------------------------------------------------"
ACS_BODY=$(if [ -n "$OPERATOR_PARTY_ID" ]; then
  jq -n --arg p "$OPERATOR_PARTY_ID" '{
    filter: [{ cumulative: [{ identifierFilter: { WildcardFilter: { value: {} } } }] }],
    readAs: [$p],
    verbose: false
  }'
else
  jq -n '{
    filter: [{ cumulative: [{ identifierFilter: { WildcardFilter: { value: {} } } }] }],
    verbose: false
  }'
fi)

ACS_FILE=$(mktemp)
trap 'rm -f "$ACS_FILE"' EXIT

ACS_HTTP=$(curl -s -o "$ACS_FILE" -w "%{http_code}" "${AUTH[@]}" -X POST \
  "$LEDGER_API_URL/v2/state/active-contracts" \
  -H "Content-Type: application/json" \
  -d "$ACS_BODY" 2>/dev/null || echo "000")

echo "  HTTP status : $ACS_HTTP"
echo "  Response size: $(wc -c < "$ACS_FILE" 2>/dev/null || echo '?') bytes"

if [ "$ACS_HTTP" != "200" ]; then
  echo "  ❌ ACS query gagal. Response (first 1000 chars):"
  head -c 1000 "$ACS_FILE"
  echo ""
  echo ""
  echo "  Kemungkinan: token tidak punya CanReadAsAnyParty right."
  echo "  Set OPERATOR_PARTY_ID lalu coba lagi, atau pakai service-account token."
  exit 1
fi

# Cek struktur response (results array?)
TOTAL_CONTRACTS=$(jq '.results | if type=="array" then length else "?" end' "$ACS_FILE" 2>/dev/null || echo "ERR")
echo "  Total contract (semua template): $TOTAL_CONTRACTS"
echo ""

if [ "$TOTAL_CONTRACTS" = "ERR" ] || [ "$TOTAL_CONTRACTS" = "?" ]; then
  echo "  ⚠️  Struktur response tidak terduga. Raw (first 1500 chars):"
  head -c 1500 "$ACS_FILE"
  echo ""
  echo ""
  echo "  Paste raw ini ke ZCode untuk analisis manual."
  exit 0
fi

# ── 2. Daftar semua template yang ada contract aktifnya ─────
echo "▶ [2/4] Distribusi contract per template (semua):"
echo "--------------------------------------------------"
# templateId di Canton ACS = { packageId, moduleName, name } atau {value:{...}}
jq -r '
  .results[]
  | .templateId as $t
  | ($t.value.name // $t.name // "?") as $name
  | ($t.value.moduleName // $t.moduleName // "?") as $mod
  | ($t.value.packageId // $t.packageId // "?") as $pkg
  | "\($pkg[0:12])...\($mod):\($name)"
' "$ACS_FILE" 2>/dev/null | sort | uniq -c | sort -rn | head -40

# Jika output kosong, dump struktur pertama untuk debug
if ! jq -e '.results[0]' "$ACS_FILE" >/dev/null 2>&1; then
  echo "  (tidak ada results, atau struktur beda). Sample contract pertama:"
  jq '.results[0] // .' "$ACS_FILE" 2>/dev/null | head -50
fi
echo ""

# ── 3. Fokus: cari contract dengan template canquest ────────
echo "▶ [3/4] Cari contract CANQUEST (Main:WalletRegistration/QuestCampaign/QuestClaim):"
echo "--------------------------------------------------"

# List nama template canquest yang dicari (di module Main)
CANQUEST_MATCHING=$(jq -r '
  .results[]
  | .templateId as $t
  | ($t.value.name // $t.name // "?") as $name
  | ($t.value.moduleName // $t.moduleName // "?") as $mod
  | ($t.value.packageId // $t.packageId // "?") as $pkg
  | select($mod == "Main" and ($name == "WalletRegistration" or $name == "QuestCampaign" or $name == "QuestClaim"))
  | "\($pkg)\t\($name)"
' "$ACS_FILE" 2>/dev/null)

if [ -z "$CANQUEST_MATCHING" ]; then
  echo "  ✅ TIDAK ADA contract canquest aktif."
  echo "     (Tidak ada template Main:WalletRegistration/QuestCampaign/QuestClaim di module Main)"
  echo ""
  # Cek juga apakah ada package dengan module Main sama sekali (bisa jadi nama template beda)
  echo "  Template lain yang ada di module 'Main':"
  jq -r '
    .results[]
    | .templateId as $t
    | ($t.value.moduleName // $t.moduleName // "?") as $mod
    | ($t.value.name // $t.name // "?") as $name
    | select($mod == "Main")
    | "    - \($name)"
  ' "$ACS_FILE" 2>/dev/null | sort -u | head -20
  echo ""
  CANQUEST_TOTAL=0
else
  echo "  Ditemukan contract canquest aktif:"
  printf '%s\n' "$CANQUEST_MATCHING" | awk -F'\t' '{ printf "    %-22s (pkg %s...)\n", $2, substr($1,1,16) }' | sort
  echo ""
  CANQUEST_TOTAL=$(printf '%s\n' "$CANQUEST_MATCHING" | wc -l | tr -d ' ')
  # Identifikasi packageId canquest (unique)
  CANQUEST_PKG=$(printf '%s\n' "$CANQUEST_MATCHING" | awk -F'\t' '{print $1}' | sort -u | head -1)
  echo "  Package ID canquest: ${CANQUEST_PKG:0:32}..."
fi
echo ""
echo "  📊 TOTAL contract canquest aktif: $CANQUEST_TOTAL"
echo ""

# ── 4. Rekomendasi ──────────────────────────────────────────
echo "▶ [4/4] Rekomendasi:"
echo "--------------------------------------------------"
if [ "$CANQUEST_TOTAL" -eq 0 ] 2>/dev/null; then
  echo "  ✅ FRESH START — ledger BERSIH dari contract canquest aktif."
  echo "     → Langsung draft canquest-v22."
  echo "     → DAR lama (kalau ada) boleh dibiarkan; unvet opsional."
  echo "     → Source v21 boleh dihapus dari repo (simpan DAR artifact utk audit)."
else
  echo "  ⚠️  Ada $CANQUEST_TOTAL contract canquest aktif."
  echo "     Breakdown:"
  printf '%s\n' "$CANQUEST_MATCHING" | awk -F'\t' '{print $2}' | sort | uniq -c | sed 's/^/       /'
  echo ""
  echo "     Opsi:"
  echo "      A) Fresh start — biarkan contract lama (audit trail), v22 independen."
  echo "         Cocok kalau cuma WalletRegistration (identitas user lama)."
  echo "      B) Archive manual dulu — kalau ada QuestCampaign dgn reward outstanding."
  echo "      C) Migrasi via Upgrade choice — kalau data perlu dipindah ke v22."
  echo ""
  echo "     Detail contract (untuk putuskan):"
  jq -r '
    .results[]
    | .templateId as $t
    | ($t.value.name // $t.name // "?") as $name
    | ($t.value.moduleName // $t.moduleName // "?") as $mod
    | select($mod == "Main" and ($name == "WalletRegistration" or $name == "QuestCampaign" or $name == "QuestClaim"))
    | "    [\($name)] contractId=\(.contractId[0:24])...  payload=\(.arguments // .createArguments // {} | tostring | .[0:120])"
  ' "$ACS_FILE" 2>/dev/null | head -30
fi
echo ""
echo "=================================================="
echo " Bawa output ini ke ZCode untuk lanjut draft v22"
echo "=================================================="
