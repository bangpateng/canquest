#!/bin/bash
# ============================================================
# CanQuest DAML Build + Test + Upload Script (untuk VPS Linux)
# Package: canquest-v4 v1.0.0  |  SDK: 3.4.11
#
# Templates (9 total):
#   1. UserAccount        2. WalletRegistration  3. QuestCampaign
#   4. QuestClaim         5. DailyCheckIn        6. SpinExecution
#   7. SpinCcReward       8. ReferralReward       9. CcTransactionLog
#
# Cara pakai:
#   1. Push kode ke VPS (git pull di VPS)
#   2. Jalankan script ini di VPS:
#        bash scripts/daml-build-vps.sh
#   3. Setelah build sukses, upload DAR:
#        cd apps/api && node scripts/upload-daml-dar.cjs
#   4. Update .env dan restart API:
#        pm2 restart canquest-api
#
# Atau jalankan semua sekaligus (build + upload):
#   bash scripts/daml-build-vps.sh --upload
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DAML_DIR="$PROJECT_ROOT/packages/daml"
DAR_NAME="canquest-v4-1.0.1.dar"
SDK_VERSION="3.4.11"

echo ""
echo "=================================================="
echo " CanQuest DAML Build + Test"
echo " Package : canquest-v4 v1.0.1"
echo " SDK     : $SDK_VERSION"
echo " Dir     : $DAML_DIR"
echo "=================================================="
echo ""

# Cek apakah daml tersedia
if ! command -v daml &> /dev/null; then
    echo "[INFO] daml not in PATH, trying ~/.daml/bin/daml ..."
    if [ -f "$HOME/.daml/bin/daml" ]; then
        DAML_CMD="$HOME/.daml/bin/daml"
    else
        echo "[ERROR] DAML SDK not found!"
        echo "Install: curl -sSL https://get.daml.com/ | sh -s $SDK_VERSION"
        exit 1
    fi
else
    DAML_CMD="daml"
fi

echo "[INFO] Using DAML: $($DAML_CMD version 2>&1 | head -1)"
echo ""

cd "$DAML_DIR"

# ── STEP 1: Build ──────────────────────────────────────────
echo "STEP 1: daml build ..."
echo ""

$DAML_CMD build

BUILD_EXIT=$?
echo ""

if [ $BUILD_EXIT -ne 0 ]; then
    echo "[FAIL] BUILD FAILED (exit $BUILD_EXIT)"
    exit 1
fi

echo "[OK] BUILD SUCCESS"

DAR_PATH="$DAML_DIR/.daml/dist/$DAR_NAME"
if [ -f "$DAR_PATH" ]; then
    DAR_SIZE=$(du -k "$DAR_PATH" | cut -f1)
    echo "[OK] DAR file: $DAR_NAME (${DAR_SIZE} KB)"
else
    echo "[WARN] DAR not found at .daml/dist/"
fi
echo ""

# ── STEP 2: Test ───────────────────────────────────────────
echo "STEP 2: daml test ..."
echo ""

$DAML_CMD test

TEST_EXIT=$?
echo ""

if [ $TEST_EXIT -ne 0 ]; then
    echo "[FAIL] TEST FAILED (exit $TEST_EXIT)"
    exit 1
fi

echo "[OK] ALL TESTS PASSED"
echo ""

# ── STEP 3: Get Package ID ─────────────────────────────────
echo "STEP 3: Get Package ID ..."
echo ""

INSPECT_OUTPUT=$($DAML_CMD damlc inspect-dar ".daml/dist/$DAR_NAME" 2>&1)
echo "$INSPECT_OUTPUT"

PKG_ID=$(echo "$INSPECT_OUTPUT" | grep -oE '[0-9a-f]{64}' | head -1)

echo ""
echo "=================================================="
echo " RESULT"
echo "=================================================="

if [ -n "$PKG_ID" ]; then
    echo "[OK] Package ID: $PKG_ID"
    echo ""
    echo "Update apps/api/.env on VPS:"
    echo "  CANTON_DAML_PACKAGE_NAME=canquest-v4"
    echo "  CANTON_DAML_PACKAGE_ID=$PKG_ID"
else
    echo "[WARN] Package ID not found - check inspect output above"
fi

echo ""
echo "Next steps:"
echo "  1. Upload DAR  : cd apps/api && node scripts/upload-daml-dar.cjs"
echo "  2. Update .env : set CANTON_DAML_PACKAGE_NAME=canquest-v4"
echo "  3. Restart API : pm2 restart canquest-api"
echo ""

# ── STEP 4 (opsional): Auto-upload jika flag --upload diberikan ────────────
if [[ "$*" == *"--upload"* ]]; then
    echo "STEP 4: Auto-upload DAR ke Canton ledger ..."
    echo ""

    API_DIR="$PROJECT_ROOT/apps/api"
    if [ ! -f "$API_DIR/scripts/upload-daml-dar.cjs" ]; then
        echo "[WARN] upload-daml-dar.cjs not found, skip upload"
    else
        cd "$API_DIR"
        node scripts/upload-daml-dar.cjs "$DAR_PATH"
        UPLOAD_EXIT=$?
        if [ $UPLOAD_EXIT -eq 0 ]; then
            echo ""
            echo "[OK] DAR uploaded successfully!"
            echo ""
            echo "Sekarang:"
            echo "  1. Update apps/api/.env:"
            echo "       CANTON_DAML_PACKAGE_NAME=canquest-v4"
            if [ -n "$PKG_ID" ]; then
                echo "       CANTON_DAML_PACKAGE_ID=$PKG_ID"
            fi
            echo "  2. pm2 restart canquest-api"
        else
            echo "[FAIL] Upload failed (exit $UPLOAD_EXIT)"
            echo "Pastikan SSH tunnel ke Canton JSON API aktif (port 7575)"
            exit 1
        fi
    fi
fi
