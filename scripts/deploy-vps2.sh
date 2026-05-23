#!/usr/bin/env bash
# Deploy CanQuest (web + API + Postgres + Redis) on VPS 2.
# Run ON the server after git pull, from repo root:
#   chmod +x scripts/deploy-vps2.sh
#   ./scripts/deploy-vps2.sh
#
# Options:
#   --seed     Run prisma seed (quests + earn hub)
#   --migrate  Use prisma migrate deploy instead of db push

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RUN_SEED=false
USE_MIGRATE=false
for arg in "$@"; do
  case "$arg" in
    --seed) RUN_SEED=true ;;
    --migrate) USE_MIGRATE=true ;;
  esac
done

echo "=== CanQuest VPS 2 deploy ==="
echo "Root: $ROOT"

if [[ ! -f apps/api/.env ]]; then
  echo "ERROR: apps/api/.env missing. Copy from infra/env/api.env.production.example"
  exit 1
fi

if [[ ! -f apps/web/.env ]]; then
  echo "WARN: apps/web/.env missing — creating from infra/env/web.env.production.example"
  cp infra/env/web.env.production.example apps/web/.env
  echo "  Edit apps/web/.env (JWT_ACCESS_SECRET must match API)."
fi

echo ""
echo "[1] Postgres + Redis (Docker)..."
docker compose -f docker-compose.yml up -d

echo ""
echo "[2] npm install (workspaces)..."
npm ci

echo ""
echo "[3] Prisma generate + database..."
cd apps/api
export PRISMA_CLIENT_ENGINE_TYPE=binary
export PRISMA_CLI_QUERY_ENGINE_TYPE=binary
npx prisma generate
if $USE_MIGRATE; then
  npx prisma migrate deploy
else
  npx prisma db push
fi
if $RUN_SEED; then
  echo "    Running seed..."
  npx ts-node prisma/seed.ts || npx prisma db seed || true
fi
cd "$ROOT"

echo ""
echo "[4] Build API..."
npm run build:api

echo ""
echo "[5] Build Web..."
npm run build:web

echo ""
echo "[6] PM2 restart..."
mkdir -p logs
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete canquest-api 2>/dev/null || true
  pm2 delete canquest-web 2>/dev/null || true
  pm2 start infra/pm2.ecosystem.config.js --env production
  pm2 save
  pm2 status
else
  echo "PM2 not installed. Install: npm i -g pm2"
  exit 1
fi

echo ""
echo "[7] Health checks..."
sleep 3
curl -sf "http://127.0.0.1:3001/api/health" && echo "  API :3001 OK" || echo "  API :3001 FAILED"
curl -sf -o /dev/null "http://127.0.0.1:3000" && echo "  Web :3000 OK" || echo "  Web :3000 FAILED"

echo ""
echo "Done. Configure nginx: infra/nginx/canquest.conf"
echo "  sudo ln -sf $ROOT/infra/nginx/canquest.conf /etc/nginx/sites-enabled/canquest"
echo "  sudo nginx -t && sudo systemctl reload nginx"
echo "Canton tunnel: infra/systemd/canton-tunnel.service.example"
