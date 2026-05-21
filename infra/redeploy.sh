#!/bin/bash
# ============================================================
# CanQuest — Re-deploy after code update (VPS 2 only)
#
# This script updates ONLY the NestJS API on VPS 2.
# The Next.js frontend (Vercel) auto-deploys on git push.
#
# Run as root from any directory on VPS 2:
#   bash /var/www/canquest/infra/redeploy.sh
# ============================================================
set -e

APP_DIR="/var/www/canquest"
cd "${APP_DIR}"

echo "==> [1/5] Pull latest code from git"
# Stash any local changes (e.g. package.json edits from npm install on VPS)
# kemudian pull, lalu buang stash karena versi dari git yang benar
git stash --include-untracked 2>/dev/null || true
git fetch origin
git reset --hard origin/master
echo "    ✓ Code updated to latest origin/master"

echo "==> [2/5] Install API dependencies"
cd "${APP_DIR}/apps/api"
npm install --legacy-peer-deps

echo "==> [3/5] Prisma generate + sync schema"
npx prisma generate
# db push: aman untuk dev & production tanpa migration history
# Jika ingin migration history, ganti dengan: npx prisma migrate deploy
npx prisma db push --accept-data-loss
echo "    ✓ Database schema synced"

echo "==> [4/5] Build NestJS API"
npm run build
cd "${APP_DIR}"

echo "==> [5/5] Restart PM2 (API only)"
pm2 restart canquest-api --update-env 2>/dev/null || \
  pm2 start "${APP_DIR}/infra/pm2.ecosystem.config.js" --only canquest-api --env production
pm2 save

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "  ✅  API redeploy done!"
echo "╚══════════════════════════════════════════════╝"
echo ""
pm2 status
echo ""
echo "  Health check:"
echo "    curl http://localhost:3001/api/health"
echo ""
echo "  Live logs:"
echo "    pm2 logs canquest-api --lines 30"
echo ""
echo "  Note: Next.js (Vercel) auto-deploys on git push."
echo "        Check: https://vercel.com/dashboard"
