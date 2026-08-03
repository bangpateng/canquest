#!/bin/bash
# ============================================================
# CanQuest — Fetch 4 DAR Splice API dependencies dari GitHub release
#
# daml build canquest-v22 butuh 4 DAR di packages/daml/dars/:
#   - splice-api-token-transfer-instruction-v1
#   - splice-api-token-holding-v1
#   - splice-api-token-metadata-v1
#   - splice-api-featured-app-v2
#
# Sumber resmi (per Canton AI): GitHub release bundle splice-node.tar.gz
#   https://github.com/digital-asset/decentralized-canton-sync/releases
# TIDAK BISA dari participant API (gRPC GetPackage balas raw bytes, bukan DAR).
#
# CARA PAKAI:
#   cd /var/www/canquest   (atau mana saja)
#   bash scripts/fetch-daml-deps.sh
#   # default: versi 0.5.0 (match SDK 3.4.11). Override:
#   #   SPLICE_VERSION=0.6.13 bash scripts/fetch-daml-deps.sh
#
# Prereq: curl, tar, find
# Output: 4 file .dar di packages/daml/dars/
# ============================================================
set -uo pipefail

# Versi Splice bundle. Default 0.5.0 (match Canton SDK 3.4.11).
# Override via env. Cek versi lain: https://github.com/canton-network/splice/releases
SPLICE_VERSION="${SPLICE_VERSION:-0.5.0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DARS_DIR="$REPO_ROOT/packages/daml/dars"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

# GitHub release bundle (Canton AI confirmed URL pattern)
BUNDLE_URL="https://github.com/digital-asset/decentralized-canton-sync/releases/download/v${SPLICE_VERSION}/${SPLICE_VERSION}_splice-node.tar.gz"

# 4 DAR target — substring nama file yg dicari di dalam bundle
declare -a TARGETS=(
  "splice-api-token-transfer-instruction-v1"
  "splice-api-token-holding-v1"
  "splice-api-token-metadata-v1"
  "splice-api-featured-app-v2"
)

for cmd in curl tar find; do
  command -v $cmd >/dev/null 2>&1 || { echo "❌ $cmd belum terinstall"; exit 1; }
done

echo ""
echo "=================================================="
echo " CanQuest — Fetch DAR Splice API Dependencies"
echo "=================================================="
echo " Splice version : $SPLICE_VERSION"
echo " Bundle URL     : $BUNDLE_URL"
echo " Output dir     : $DARS_DIR"
echo "=================================================="
echo ""

mkdir -p "$DARS_DIR"

# Cek DAR yg sudah ada — skip kalau lengkap
EXISTING=0
for tgt in "${TARGETS[@]}"; do
  if ls "$DARS_DIR"/${tgt}*.dar >/dev/null 2>&1; then
    EXISTING=$((EXISTING + 1))
  fi
done
if [ "$EXISTING" -eq 4 ]; then
  echo "✅ Semua 4 DAR sudah ada di $DARS_DIR. Skip download."
  ls -1 "$DARS_DIR"/splice-api-*.dar 2>/dev/null | sed 's|.*/|  • |'
  exit 0
fi
echo "  ($EXISTING/4 DAR sudah ada, download sisanya)"
echo ""

# ── 1. Download bundle ───────────────────────────────────────
echo "▶ [1/3] Download bundle splice-node.tar.gz v$SPLICE_VERSION..."
echo "       (bundle besar ~200MB, mungkin butuh beberapa menit)"
echo "--------------------------------------------------"
BUNDLE_FILE="$TMP_DIR/splice-node.tar.gz"
HTTP=$(curl -sL -o "$BUNDLE_FILE" -w "%{http_code}" "$BUNDLE_URL" 2>/dev/null || echo "000")
if [ "$HTTP" != "200" ]; then
  echo "❌ Download gagal (HTTP $HTTP)."
  echo "   Cek versi: https://github.com/canton-network/splice/releases"
  echo "   Coba versi lain:"
  echo "     SPLICE_VERSION=0.6.13 bash scripts/fetch-daml-deps.sh   (MainNet)"
  echo "     SPLICE_VERSION=0.6.14 bash scripts/fetch-daml-deps.sh   (TestNet)"
  echo "     SPLICE_VERSION=0.7.0  bash scripts/fetch-daml-deps.sh   (DevNet)"
  exit 1
fi
SIZE=$(du -h "$BUNDLE_FILE" | cut -f1)
echo "✅ Bundle terdownload ($SIZE)"
echo ""

# ── 2. Extract bundle ────────────────────────────────────────
echo "▶ [2/3] Extract bundle..."
echo "--------------------------------------------------"
EXTRACT_DIR="$TMP_DIR/extracted"
mkdir -p "$EXTRACT_DIR"
tar xzf "$BUNDLE_FILE" -C "$EXTRACT_DIR" 2>/dev/null || {
  echo "❌ Extract gagal. File mungkin corrupt."
  exit 1
}
echo "✅ Bundle ter-extract"
echo ""

# ── 3. Cari + copy 4 DAR target ──────────────────────────────
echo "▶ [3/3] Cari + copy 4 DAR Splice API ke $DARS_DIR:"
echo "--------------------------------------------------"
FOUND_COUNT=0
for tgt in "${TARGETS[@]}"; do
  # Skip kalau sudah ada
  if ls "$DARS_DIR"/${tgt}*.dar >/dev/null 2>&1; then
    EXISTING_FILE=$(ls "$DARS_DIR"/${tgt}*.dar | head -1)
    echo "  ✅ $tgt (sudah ada: $(basename "$EXISTING_FILE"))"
    FOUND_COUNT=$((FOUND_COUNT + 1))
    continue
  fi

  # Cari DAR di extracted bundle (nama file mengandung target substring)
  MATCH=$(find "$EXTRACT_DIR" -name "${tgt}*.dar" -type f 2>/dev/null | head -1)
  if [ -n "$MATCH" ]; then
    cp "$MATCH" "$DARS_DIR/"
    echo "  ✅ $tgt → $(basename "$MATCH")"
    FOUND_COUNT=$((FOUND_COUNT + 1))
  else
    echo "  ❌ $tgt tidak ditemukan di bundle"
  fi
done
echo ""

# ── Summary ──────────────────────────────────────────────────
echo "=================================================="
echo " SUMMARY"
echo "=================================================="
echo " DAR di $DARS_DIR:"
ls -1 "$DARS_DIR"/*.dar 2>/dev/null | sed 's|.*/|  • |'
echo ""
echo " Target found: $FOUND_COUNT / 4"
if [ "$FOUND_COUNT" -eq 4 ]; then
  echo ""
  echo " ✅ SEMUA DAR dependencies siap."
  echo "    Sekarang bisa daml build:"
  echo "      cd packages/daml"
  echo "      daml build"
  echo ""
  echo "    Update daml.yaml data-dependencies kalau nama file beda"
  echo "    (cek: ls packages/daml/dars/splice-api-*.dar)"
else
  echo ""
  echo " ⚠️  Ada DAR belum ketemu."
  echo "    Cek isi bundle: find $EXTRACT_DIR -name '*.dar'"
  echo "    Mungkin nama berbeda — adjust TARGETS di script ini."
fi
echo "=================================================="
