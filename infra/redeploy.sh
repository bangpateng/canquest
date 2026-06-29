#!/bin/bash
# ============================================================
# CanQuest — Re-deploy after code update (VPS 2 only)
# Web (Next.js) runs on Vercel — only API (NestJS) runs here.
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
git stash --include-untracked 2>/dev/null || true
git fetch origin
git reset --hard origin/master
echo "    ✓ $(git log -1 --format='%h %s')"

# ───────────────────────────────────────────────────────────────
echo "==> [2/6] Install dependencies"
cd "${APP_DIR}"

# Hapus node_modules lama
rm -rf node_modules apps/api/node_modules

# Install dari root (workspace hoist)
npm install --legacy-peer-deps
echo "    ✓ Root node_modules installed"

# Install ulang di apps/api agar @nestjs/platform-express dan deps lain
# tersedia di apps/api/node_modules (fix: No driver HTTP error)
cd "${API_DIR}"
npm install --legacy-peer-deps
echo "    ✓ API node_modules installed"
cd "${APP_DIR}"

# ───────────────────────────────────────────────────────────────
echo "==> [3/6] Prisma generate + apply migrations"
cd "${API_DIR}"
npx prisma generate

# SECURITY (M9): Use 'migrate deploy' instead of 'db push --accept-data-loss'.
# 'db push --accept-data-loss' can silently drop columns/tables on the production
# DB that holds real wallet balances and CC history — and it SKIPS the migration
# SQL files (so de-dup logic like the H6 cantonPartyId migration never runs).
# 'migrate deploy' applies only reviewed migration files, non-destructively.
#
# Safety net: dump the DB first so a bad migration can be rolled back.
DB_BACKUP="/tmp/canquest_db_backup_$(date +%Y%m%d_%H%M%S).sql"
if pg_dump "$DATABASE_URL" > "${DB_BACKUP}" 2>/dev/null; then
  echo "    ✓ DB backup saved to ${DB_BACKUP}"
else
  echo "    ⚠  Could not dump DB (DATABASE_URL may be set per-process by PM2)."
  echo "       Continuing — if you have shell DB access, back up manually first."
fi

npx prisma migrate deploy
echo "    ✓ Database migrations applied"
cd "${APP_DIR}"

# ───────────────────────────────────────────────────────────────
echo "==> [4/6] Build NestJS API"
cd "${API_DIR}"
npm run build
echo "    ✓ API build complete: $(ls dist/main.js)"
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
echo "==> [6/6] Start / Restart PM2 (API only)"
if pm2 describe canquest-api > /dev/null 2>&1; then
  echo "    Process found in PM2 — restarting..."
  pm2 restart canquest-api --update-env
else
  echo "    Process not found in PM2 — starting fresh..."
  pm2 start "${APP_DIR}/infra/pm2.ecosystem.config.js" --only canquest-api --env production
fi
pm2 save
echo "    ✓ PM2 done"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "  ✅  API redeploy done! (Web = Vercel auto)"
echo "╚══════════════════════════════════════════════╝"
echo ""
pm2 status
echo ""
echo "  Verify:"
echo "    curl http://localhost:3001/api/health"
echo ""
echo "  Live logs:"
echo "    pm2 logs canquest-api --lines 40 --nostream"
