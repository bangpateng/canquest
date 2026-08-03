#!/bin/bash
# ============================================================
# CanQuest — Cek Contract v21 Aktif (v4 — format body Canton benar)
#
# Fix v4 (vs v3):
#   - Body ACS pakai eventFormat.filtersByParty (BUKAN filter[]+readAs)
#     — ini penyebab HTTP 400 "Missing required field filtersByParty"
#   - WAJIB set party: auto-baca dari .env backend VPS 2 kalau
#     OPERATOR_PARTY_ID tidak diset eksplisit
#   - Response format nested: results[].contractEntry.JsActiveContract
#     .createdEvent.templateId.{packageId,moduleName,name}
#
# CARA PAKAI (di VPS 2, /var/www/canquest):
#   bash scripts/check-v21-active-contracts.sh
#   # (akan auto-baca LEDGER_CLIENT_ID/SECRET + OPERATOR_PARTY_ID dari apps/api/.env)
#
# Atau manual:
#   export LEDGER_CLIENT_ID="..." LEDGER_CLIENT_SECRET="..."
#   export OPERATOR_PARTY_ID="canquest-operator::..."
#   bash scripts/check-v21-active-contracts.sh
#
# Prereq: curl, jq. READ-ONLY.
# ============================================================

LEDGER_API_URL="${LEDGER_API_URL:-https://ledger.canquestlabs.com}"
KEYCLOAK_URL="${KEYCLOAK_URL:-https://auth.canquestlabs.com}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-canton}"
LEDGER_API_AUTH_SCOPE="${LEDGER_API_AUTH_SCOPE:-daml_ledger_api}"

# ── Auto-load dari apps/api/.env kalau ada (VPS 2 path) ──────
ENV_FILE=""
for candidate in "/var/www/canquest/apps/api/.env" "./apps/api/.env" "../apps/api/.env"; do
  if [ -f "$candidate" ]; then ENV_FILE="$candidate"; break; fi
done

load_env_value() {
  local key="$1" default="$2"
  if [ -n "$ENV_FILE" ]; then
    local v
    v=$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    if [ -n "$v" ]; then printf '%s' "$v"; return; fi
  fi
  printf '%s' "$default"
}

LEDGER_CLIENT_ID="${LEDGER_CLIENT_ID:-$(load_env_value LEDGER_CLIENT_ID '')}"
LEDGER_CLIENT_SECRET="${LEDGER_CLIENT_SECRET:-$(load_env_value LEDGER_CLIENT_SECRET '')}"
OPERATOR_PARTY_ID="${OPERATOR_PARTY_ID:-$(load_env_value CANTON_OPERATOR_PARTY_ID '')}"
if [ -z "$OPERATOR_PARTY_ID" ]; then
  OPERATOR_PARTY_ID="$(load_env_value CANTON_VALIDATOR_PARTY_ID '')"
fi

command -v jq   >/dev/null 2>&1 || { echo "❌ jq belum terinstall"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "❌ curl belum terinstall"; exit 1; }

echo ""
echo "▶ [0/4] Konfigurasi:"
[ -n "$ENV_FILE" ] && echo "       .env         : $ENV_FILE (auto-loaded)" || echo "       .env         : (tidak ditemukan, pakai env eksplisit)"
echo "       client_id    : ${LEDGER_CLIENT_ID:-(KOSONG)}"
echo "       operator     : ${OPERATOR_PARTY_ID:-(KOSONG — AKAN GAGAL)}"
echo ""

if [ -z "$LEDGER_CLIENT_ID" ] || [ -z "$LEDGER_CLIENT_SECRET" ]; then
  echo "❌ LEDGER_CLIENT_ID / LEDGER_CLIENT_SECRET kosong."
  echo "   Set eksplisit atau pastikan apps/api/.env ada."
  exit 1
fi
if [ -z "$OPERATOR_PARTY_ID" ]; then
  echo "❌ OPERATOR_PARTY_ID kosong. Canton ACS query WAJIB specify party."
  echo "   Set CANTON_OPERATOR_PARTY_ID di apps/api/.env, atau:"
  echo "      export OPERATOR_PARTY_ID=\"<party::xxx>\""
  exit 1
fi

# ── 1. Token Keycloak ────────────────────────────────────────
TOKEN_URL="${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"
echo "▶ [1/4] Ambil token ledger dari Keycloak..."
echo "       POST $TOKEN_URL"
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
EXP=$(printf '%s' "$TOKEN_RESP" | jq -r '.expires_in // "?"')
echo "✅ Token dapat (len=${#TOKEN}, expires_in=${EXP}s)"
echo ""

AUTH=(-H "Authorization: Bearer $TOKEN")

echo "=================================================="
echo " CanQuest — Cek Contract Aktif (operator view)"
echo " Ledger   : $LEDGER_API_URL"
echo " Operator : ${OPERATOR_PARTY_ID}"
echo "=================================================="
echo ""

# ── 2. Query ACS — format body BENAR (filtersByParty) ───────
echo "▶ [2/4] Query Active Contract Set (operator party):"
echo "--------------------------------------------------"

# Body persis sesuai canton-ledger.service.ts:1472 — eventFormat.filtersByParty
ACS_BODY=$(jq -n --arg party "$OPERATOR_PARTY_ID" '{
  eventFormat: {
    filtersByParty: {
      ($party): {
        cumulative: [
          { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }
        ]
      }
    },
    verbose: true
  }
}')

ACS_FILE=$(mktemp)
trap 'rm -f "$ACS_FILE"' EXIT

ACS_HTTP=$(curl -s -o "$ACS_FILE" -w "%{http_code}" "${AUTH[@]}" -X POST \
  "$LEDGER_API_URL/v2/state/active-contracts" \
  -H "Content-Type: application/json" \
  -d "$ACS_BODY" 2>/dev/null || echo "000")

echo "  HTTP status  : $ACS_HTTP"
echo "  Response size: $(wc -c < "$ACS_FILE" 2>/dev/null || echo '?') bytes"

if [ "$ACS_HTTP" != "200" ]; then
  echo "  ❌ ACS query gagal. Response (first 1000 chars):"
  head -c 1000 "$ACS_FILE"
  echo ""
  echo ""
  echo "  Kemungkinan:"
  echo "   - 403/401: token tidak punya right CanReadAs utk operator party"
  echo "   - 400    : party ID format salah (harus 'name::hash')"
  exit 1
fi
echo ""

# ── 3. Parse hasil — cari contract canquest (module Main) ────
echo "▶ [3/4] Distribusi contract per template (top 30):"
echo "--------------------------------------------------"

# Response Canton: results[].contractEntry.JsActiveContract.createdEvent
# Atau bisa juga flat. Handle dua-duanya.
jq -r '
  .results[]?
  | (
      (.contractEntry.JsActiveContract.createdEvent.templateId) //
      (.contractEntry.JsActiveContract.createdEvent.template_id) //
      (.createdEvent.templateId) //
      (.templateId)
    ) as $t
  | (
      ($t.value.name // $t.name // "?") as $name |
      ($t.value.moduleName // $t.moduleName // "?") as $mod |
      ($t.value.packageId // $t.packageId // "?") as $pkg
    )
  | "\($pkg[0:12])...\($mod):\($name)"
' "$ACS_FILE" 2>/dev/null | sort | uniq -c | sort -rn | head -30

echo ""

# Cari khusus canquest (module Main)
echo "▶ [4/4] Cari contract CANQUEST (Main:WalletRegistration/QuestCampaign/QuestClaim):"
echo "--------------------------------------------------"

CANQUEST=$(jq -r '
  .results[]?
  | (
      (.contractEntry.JsActiveContract.createdEvent.templateId) //
      (.contractEntry.JsActiveContract.createdEvent.template_id) //
      (.createdEvent.templateId) //
      (.templateId)
    ) as $t
  | (($t.value.name // $t.name // "?")) as $name
  | (($t.value.moduleName // $t.moduleName // "?")) as $mod
  | (($t.value.packageId // $t.packageId // "?")) as $pkg
  | select($mod == "Main" and ($name == "WalletRegistration" or $name == "QuestCampaign" or $name == "QuestClaim"))
  | "\($pkg)\t\($name)"
' "$ACS_FILE" 2>/dev/null)

if [ -z "$CANQUEST" ]; then
  echo "  ✅ TIDAK ADA contract canquest (module Main) aktif."
  echo ""
  echo "  Template lain yg ada di module 'Main' (kalau ada):"
  jq -r '
    .results[]?
    | ((.contractEntry.JsActiveContract.createdEvent.templateId) // (.createdEvent.templateId) // .templateId) as $t
    | (($t.value.moduleName // $t.moduleName // "?")) as $mod
    | (($t.value.name // $t.name // "?")) as $name
    | select($mod == "Main")
    | "    - \($name)"
  ' "$ACS_FILE" 2>/dev/null | sort -u | head -20
  echo ""
  echo "  → LEDGER BERSIH dari DAML canquest lama."
  echo "  → Bisa langsung FRESH START: draft canquest-v22."
  CANQUEST_TOTAL=0
else
  echo "  ⚠️  Ditemukan contract canquest aktif:"
  printf '%s\n' "$CANQUEST" | awk -F'\t' '{ printf "    %-22s pkg=%s...\n", $2, substr($1,1,16) }'
  echo ""
  CANQUEST_TOTAL=$(printf '%s\n' "$CANQUEST" | wc -l | tr -d ' ')
  echo "  📊 TOTAL contract canquest aktif: $CANQUEST_TOTAL"
  echo ""
  echo "  Breakdown per template:"
  printf '%s\n' "$CANQUEST" | awk -F'\t' '{print $2}' | sort | uniq -c | sed 's/^/    /'
fi

echo ""
echo "=================================================="
if [ "${CANQUEST_TOTAL:-0}" -eq 0 ]; then
  echo " ✅ KESIMPULAN: FRESH START"
  echo "    Ledger bersih → langsung draft canquest-v22."
else
  echo " ⚠️  KESIMPULAN: Ada \$CANQUEST_TOTAL contract aktif"
  echo "    Bawa output ini ke ZCode untuk putuskan archive/migrate."
fi
echo "=================================================="
