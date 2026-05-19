#!/bin/bash
# ============================================================
# CanQuest — VPS 2 (62.171.185.56) Backend Deploy Script
#
# This VPS runs: NestJS API + PostgreSQL + Redis + Canton SSH tunnel
# Next.js frontend is deployed on Vercel separately.
#
# Run as root on a fresh Ubuntu 22.04 / 24.04:
#   bash deploy.sh
# ============================================================
set -e

APP_DIR="/var/www/canquest"
LOG_DIR="/var/log/canquest"
REPO_URL="YOUR_GIT_REPO_URL_HERE"      # e.g. git@github.com:you/canquest.git
PG_PASSWORD="CHANGE_ME_STRONG_PASSWORD" # Must match infra/env/api.env.production DATABASE_URL

echo "==> [1/8] Update system packages"
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git

echo "==> [2/8] Install Node.js 20 LTS"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v && npm -v

echo "==> [3/8] Install PostgreSQL"
apt-get install -y postgresql postgresql-contrib
systemctl enable --now postgresql

sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'canquest') THEN
    CREATE USER canquest WITH PASSWORD '${PG_PASSWORD}';
  END IF;
END \$\$;

SELECT 'CREATE DATABASE canquest_app OWNER canquest'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'canquest_app') \gexec
GRANT ALL PRIVILEGES ON DATABASE canquest_app TO canquest;
SQL

echo "==> [4/8] Install Redis"
apt-get install -y redis-server
sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis/redis.conf
systemctl enable --now redis-server

echo "==> [5/8] Install nginx + certbot"
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable nginx

echo "==> [6/8] Set up SSH key for Canton tunnel (VPS 1)"
if [ ! -f /root/.ssh/canton_tunnel ]; then
  ssh-keygen -t ed25519 -f /root/.ssh/canton_tunnel -N ""
  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  ACTION REQUIRED: Add this public key to VPS 1"
  echo "  (162.250.191.46) → /root/.ssh/authorized_keys"
  echo "════════════════════════════════════════════════════════"
  cat /root/.ssh/canton_tunnel.pub
  echo "════════════════════════════════════════════════════════"
  read -p "Press ENTER after adding the key to VPS 1..."
fi

echo "==> [6b/8] Install Canton tunnel systemd service"
cp "${APP_DIR}/infra/systemd/canton-tunnel.service" /etc/systemd/system/canton-tunnel.service
systemctl daemon-reload
systemctl enable --now canton-tunnel
sleep 3
echo "--- Canton tunnel status ---"
systemctl status canton-tunnel --no-pager || true
echo "--- Verify port 7575 ---"
curl -s --max-time 5 http://127.0.0.1:7575/livez && echo " ← OK" || echo " ← WARN: tunnel may need a moment"

echo "==> [7/8] Clone / update repository"
mkdir -p "${APP_DIR}" "${LOG_DIR}"
if [ -d "${APP_DIR}/.git" ]; then
  cd "${APP_DIR}" && git pull
else
  git clone "${REPO_URL}" "${APP_DIR}"
fi
cd "${APP_DIR}"

echo "⚠️  Make sure infra/env/api.env.production has real secrets before continuing!"
read -p "Press ENTER to continue..."
cp "${APP_DIR}/infra/env/api.env.production" "${APP_DIR}/apps/api/.env"

echo "==> [7b/8] Install API dependencies"
cd "${APP_DIR}/apps/api"
npm ci

echo "==> [7c/8] Prisma generate + push schema"
npx prisma generate
# db push syncs schema directly to PostgreSQL without needing migration history.
# On future deploys after migrations are created, switch to: npx prisma migrate deploy
npx prisma db push

echo "==> [7d/8] Build NestJS"
npm run build
cd "${APP_DIR}"

echo "==> [8/8] Install PM2 + configure nginx"
npm install -g pm2
pm2 startup systemd -u root --hp /root | tail -1 | bash

# Start only the API process
pm2 start "${APP_DIR}/infra/pm2.ecosystem.config.js" --only canquest-api --env production
pm2 save

# Nginx — API only
cp "${APP_DIR}/infra/nginx/canquest-api.conf" /etc/nginx/sites-available/canquest-api
ln -sf /etc/nginx/sites-available/canquest-api /etc/nginx/sites-enabled/canquest-api
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo ""
echo "✅ VPS 2 backend deploy complete!"
echo ""
echo "Next steps:"
echo "  1. Add DNS A record:  api.canquest.cc → 62.171.185.56"
echo "  2. Get SSL cert:      certbot --nginx -d api.canquest.cc"
echo "  3. Deploy frontend:   push code → Vercel auto-deploys"
echo "  4. PM2 status:        pm2 status"
echo "  5. API health check:  curl https://api.canquest.cc/api/health"
