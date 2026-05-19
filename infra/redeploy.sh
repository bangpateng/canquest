#!/bin/bash
# CanQuest — Re-deploy after code update
# Run from /var/www/canquest on VPS 2
set -e

APP_DIR="/var/www/canquest"
cd "${APP_DIR}"

echo "==> Pull latest code"
git pull

echo "==> Install dependencies"
npm ci --workspace=api --workspace=web

echo "==> Prisma migrate"
cd "${APP_DIR}/apps/api"
npx prisma generate
npx prisma migrate deploy
cd "${APP_DIR}"

echo "==> Build"
npm run build:api
npm run build:web

echo "==> Restart PM2"
pm2 restart canquest-api canquest-web

echo "✅ Redeploy done"
pm2 status
