#!/bin/bash
# ============================================================
# CanQuest — Re-deploy after code update (VPS 2 only)
#
# Run as root on VPS 2:
#   bash /var/www/canquest/infra/redeploy.sh
# ============================================================
set -e

APP_DIR="/var/www/canquest"
API_DIR="${APP_DIR}/apps/api"

cd "${APP_DIR}"

# ───────────────────────────────────────────────────────────────
echo "==> [1/6] Pull latest code from git"
# Buang semua local changes (termasuk package.json, package-lock.json dari
# npm install yang pernah dijalankan langsung di VPS)
git stash --include-untracked 2>/dev/null || true
git fetch origin
git reset --hard origin/master
echo "    ✓ $(git log -1 --format='%h %s')"

# ───────────────────────────────────────────────────────────────
echo "==> [2/6] Install ALL dependencies dari root (npm workspaces)"
cd "${APP_DIR}"

# Install dari ROOT karena package.json root punya workspaces: ["apps/*"]
# Semua packages di-hoist ke /var/www/canquest/node_modules/
# PM2 juga jalan dari root sehingga node bisa resolve packages dengan benar
echo "    Removing old root node_modules..."
rm -rf node_modules apps/api/node_modules apps/web/node_modules

npm install --legacy-peer-deps
echo "    ✓ node_modules installed ($(ls node_modules | wc -l) packages)"

# ───────────────────────────────────────────────────────────────
echo "==> [3/6] Prisma generate + sync database schema"
cd "${API_DIR}"
npx prisma generate
npx prisma db push --accept-data-loss
echo "    ✓ Database schema synced"
cd "${APP_DIR}"

# ───────────────────────────────────────────────────────────────
echo "==> [4/6] Build NestJS API"
cd "${API_DIR}"
npm run build
echo "    ✓ Build complete: $(ls dist/main.js)"
cd "${APP_DIR}"

# ───────────────────────────────────────────────────────────────
echo "==> [5/6] Check Redis (required for BullMQ queue)"
if redis-cli ping 2>/dev/null | grep -q PONG; then
  echo "    ✓ Redis is running"
else
  echo "    ⚠  Redis not running — starting it..."
  systemctl start redis-server 2>/dev/null || \
  systemctl start redis 2>/dev/null || \
  echo "    ⚠  Could not start Redis automatically. Run: apt install redis-server"
fi

# ───────────────────────────────────────────────────────────────
echo "==> [6/6] Start / Restart PM2"
# Cek apakah process sudah terdaftar di PM2
if pm2 describe canquest-api > /dev/null 2>&1; then
  echo "    Process found in PM2 — restarting..."
  pm2 restart canquest-api --update-env
else
  echo "    Process not found in PM2 — starting fresh..."
  pm2 start "${APP_DIR}/infra/pm2.ecosystem.config.js" --env production
fi
pm2 save
echo "    ✓ PM2 done"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "  ✅  API redeploy done!"
echo "╚══════════════════════════════════════════════╝"
echo ""
pm2 status
echo ""
echo "  Verify:"
echo "    curl http://localhost:3001/api/health"
echo ""
echo "  Live logs:"
echo "    pm2 logs canquest-api --lines 40 --nostream"
