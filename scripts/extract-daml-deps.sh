#!/bin/bash
# ============================================================
# CanQuest — Extract 4 DAR Splice API dependencies dari participant
#
# daml build canquest-v22 butuh 4 DAR di packages/daml/dars/:
#   - splice-api-token-transfer-instruction-v1.dar
#   - splice-api-token-holding-v1.dar
#   - splice-api-token-metadata-v1.dar
#   - splice-api-featured-app-v2.dar
#
# Canton AI: extract dari participant node SENDIRI (ABI-compat),
# BUKAN download dari release bundle berbeda.
#
# CARA PAKAI (di VPS 2 atau mana saja yg bisa reach ledger):
#   cd /var/www/canquest
#   bash scripts/extract-daml-deps.sh
#   # (auto-load apps/api/.env utk credentials)
#
# Prereq: curl, jq, python3 (utk baca zip manifest DAR).
# Output: 4 file .dar di packages/daml/dars/
# ============================================================

set -uo pipefail

LEDGER_API_URL="${LEDGER_API_URL:-https://ledger.canquestlabs.com}"
KEYCLOAK_URL="${KEYCLOAK_URL:-https://auth.canquestlabs.com}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-canton}"
LEDGER_API_AUTH_SCOPE="${LEDGER_API_AUTH_SCOPE:-daml_ledger_api}"

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

# Repo root (utk path packages/daml/dars/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DARS_DIR="$REPO_ROOT/packages/daml/dars"

# 4 DAR target (nama file output + substring nama package yg dicari)
declare -a TARGETS=(
  "splice-api-token-transfer-instruction-v1.dar|transfer-instruction-v1"
  "splice-api-token-holding-v1.dar|token-holding-v1"
  "splice-api-token-metadata-v1.dar|token-metadata-v1"
  "splice-api-featured-app-v2.dar|featured-app-v2"
)

for cmd in curl jq python3; do
  command -v $cmd >/dev/null 2>&1 || { echo "❌ $cmd belum terinstall"; exit 1; }
done

if [ -z "$LEDGER_CLIENT_ID" ] || [ -z "$LEDGER_CLIENT_SECRET" ]; then
  echo "❌ LEDGER_CLIENT_ID / LEDGER_CLIENT_SECRET kosong."
  echo "   Set eksplisit atau pastikan apps/api/.env ada."
  exit 1
fi

echo ""
echo "=================================================="
echo " CanQuest — Extract DAR Splice API Dependencies"
echo "=================================================="
[ -n "$ENV_FILE" ] && echo " .env       : $ENV_FILE" || echo " .env       : (env eksplisit)"
echo " Ledger     : $LEDGER_API_URL"
echo " Output dir : $DARS_DIR"
echo "=================================================="
echo ""

mkdir -p "$DARS_DIR"

# ── 1. Token Keycloak ────────────────────────────────────────
TOKEN_URL="${KEYCLOAK_URL%/}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token"
echo "▶ [1/4] Ambil token dari Keycloak..."
TOKEN=$(curl -s -X POST "$TOKEN_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$LEDGER_CLIENT_ID" \
  --data-urlencode "client_secret=$LEDGER_CLIENT_SECRET" \
  --data-urlencode "scope=$LEDGER_API_AUTH_SCOPE" 2>/dev/null \
  | jq -r '.access_token // empty' 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "❌ Token kosong. Cek credentials Keycloak."
  exit 1
fi
echo "✅ Token dapat (len=${#TOKEN})"
echo ""

AUTH=(-H "Authorization: Bearer $TOKEN")

# ── 2. List semua package ID ─────────────────────────────────
echo "▶ [2/4] List package IDs dari participant..."
PKG_IDS=$(curl -s "${AUTH[@]}" "$LEDGER_API_URL/v2/packages" 2>/dev/null \
  | jq -r '.packageIds[]?' 2>/dev/null)
PKG_COUNT=$(echo "$PKG_IDS" | grep -c . || echo 0)
echo "   Total package: $PKG_COUNT"
echo ""

# ── 3. Resolve nama + download 4 DAR target ─────────────────
echo "▶ [3/4] Resolve nama package + download 4 DAR target:"
echo "--------------------------------------------------"

FOUND_COUNT=0
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

for entry in "${TARGETS[@]}"; do
  out_file="${entry%%|*}"
  name_pattern="${entry#*|}"
  out_path="$DARS_DIR/$out_file"

  # Skip kalau sudah ada
  if [ -f "$out_path" ]; then
    echo "  ✅ $out_file (sudah ada, skip)"
    FOUND_COUNT=$((FOUND_COUNT + 1))
    continue
  fi

  echo "  🔍 Cari package: $name_pattern"

  # Iterasi package ID, download + inspect name
  MATCH_PID=""
  while IFS= read -r pid; do
    [ -z "$pid" ] && continue

    # Download DAR binary ke tmp
    TMP_DAR="$TMP_DIR/${pid}.dar"
    HTTP=$(curl -s -o "$TMP_DAR" -w "%{http_code}" "${AUTH[@]}" \
      "$LEDGER_API_URL/v2/packages/$pid" 2>/dev/null || echo "000")

    [ "$HTTP" != "200" ] && continue

    # DAR = ZIP. Baca daml.yaml dari dalam zip utk dapat name.
    NAME=$(python3 -c "
import zipfile, sys, re
try:
    with zipfile.ZipFile('$TMP_DAR') as z:
        for n in z.namelist():
            if n.endswith('daml.yaml'):
                data = z.read(n).decode('utf-8', errors='ignore')
                m = re.search(r'^name:\s*(.+)$', data, re.MULTILINE)
                if m:
                    print(m.group(1).strip())
                    break
except Exception:
    pass
" 2>/dev/null)

    if echo "$NAME" | grep -qi "$name_pattern"; then
      MATCH_PID="$pid"
      cp "$TMP_DAR" "$out_path"
      echo "     ✅ MATCH: $NAME (pid=${pid:0:16}...) → $out_file"
      FOUND_COUNT=$((FOUND_COUNT + 1))
      break
    fi
  done <<< "$PKG_IDS"

  [ -z "$MATCH_PID" ] && echo "     ❌ Tidak ketemu package dgn pattern '$name_pattern'"
done
echo ""

# ── 4. Summary ───────────────────────────────────────────────
echo "▶ [4/4] Summary:"
echo "--------------------------------------------------"
echo "  DAR di $DARS_DIR:"
ls -1 "$DARS_DIR"/*.dar 2>/dev/null | sed 's|.*/|    - |'
echo ""
echo "  Target found: $FOUND_COUNT / 4"

if [ "$FOUND_COUNT" -eq 4 ]; then
  echo ""
  echo "  ✅ SEMUA DAR dependencies siap."
  echo "     Sekarang bisa daml build:"
  echo "       cd packages/daml && daml build"
else
  echo ""
  echo "  ⚠️  Ada DAR yang belum ketemu."
  echo "     Kemungkinan:"
  echo "     - Nama package berbeda (cek pattern matching)"
  echo "     - DAR belum ter-upload ke participant"
  echo "     - Endpoint download binary berbeda format"
  echo "     Coba manual: curl -s -H \"Authorization: Bearer \$TOKEN\" \\"
  echo "       \"$LEDGER_API_URL/v2/packages/<id>\" -o test.dar"
fi
echo ""
echo "=================================================="
