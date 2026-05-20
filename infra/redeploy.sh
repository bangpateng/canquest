#!/bin/bash
# ============================================================
# CanQuest — Re-deploy after code update (VPS 2 only)
#
# This script updates ONLY the NestJS API on VPS 2.
# The Next.js frontend (Vercel) auto-deploys on git push — no
# action needed here for the web app.
#
# Run as root from any directory on VPS 2:
#   bash /var/www/canquest/infra/redeploy.sh
# ============================================================
set -e

APP_DIR="/var/www/canquest"
cd "${APP_DIR}"

echo "==> [1/5] Pull latest code from git"
git pull

echo "==> [2/5] Install API dependencies"
cd "${APP_DIR}/apps/api"
npm ci

echo "==> [3/5] Prisma generate + migrate"
npx prisma generate
npx prisma migrate deploy

echo "==> [4/5] Build NestJS API"
npm run build
cd "${APP_DIR}"

echo "==> [5/5] Restart PM2 (API only)"
pm2 restart canquest-api --update-env
pm2 save

echo ""
echo "✅ API redeploy done."
echo ""
pm2 status
echo ""
echo "Note: Next.js frontend is on Vercel — it auto-deploys when you push to git."
echo "      Check status at: https://vercel.com/dashboard"
