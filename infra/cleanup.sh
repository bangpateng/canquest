#!/bin/bash
# ============================================================
# CanQuest — VPS 2 Clean Wipe Script
#
# Removes ALL app-layer resources so you can do a fresh deploy.
# Does NOT uninstall Node, PostgreSQL, Redis, nginx, or PM2.
# Does NOT touch VPS 1 (Canton validator node).
#
# Run as root on VPS 2:
#   bash /var/www/canquest/infra/cleanup.sh
#   -- or if the folder is already deleted --
#   bash cleanup.sh
#
# After this script completes, run a fresh deploy:
#   bash /var/www/canquest/infra/deploy.sh
# ============================================================
set -e

APP_DIR="/var/www/canquest"
LOG_DIR="/var/log/canquest"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "  CanQuest VPS 2 — Clean Wipe"
echo "  This will remove the app, PM2 processes, nginx config,"
echo "  and optionally the PostgreSQL database."
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Confirm ────────────────────────────────────────────────────────────────────
read -p "Continue with full wipe? [y/N] " CONFIRM
if [[ "${CONFIRM,,}" != "y" ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "==> [1/6] Stop and remove PM2 processes"
# Stop canquest-api if running, ignore errors if not found
pm2 stop canquest-api 2>/dev/null || true
pm2 delete canquest-api 2>/dev/null || true
pm2 save --force 2>/dev/null || true
echo "    PM2 processes removed."

echo ""
echo "==> [2/6] Remove nginx site config"
rm -f /etc/nginx/sites-enabled/canquest-api
rm -f /etc/nginx/sites-available/canquest-api
# Remove any old web config if it exists
rm -f /etc/nginx/sites-enabled/canquest
rm -f /etc/nginx/sites-available/canquest
# Reload nginx (restore default if needed)
nginx -t && systemctl reload nginx && echo "    nginx reloaded." || echo "    WARN: nginx reload failed — check config manually."

echo ""
echo "==> [3/6] Remove Canton tunnel systemd service"
systemctl stop canton-tunnel 2>/dev/null || true
systemctl disable canton-tunnel 2>/dev/null || true
rm -f /etc/systemd/system/canton-tunnel.service
systemctl daemon-reload
echo "    Canton tunnel service removed."

echo ""
echo "==> [4/6] Remove app directory and logs"
rm -rf "${APP_DIR}"
rm -rf "${LOG_DIR}"
echo "    Removed ${APP_DIR} and ${LOG_DIR}."

echo ""
echo "==> [5/6] PostgreSQL — optional database drop"
echo ""
read -p "Drop the 'canquest_app' PostgreSQL database? [y/N] " DROP_DB
if [[ "${DROP_DB,,}" == "y" ]]; then
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS canquest_app;" && echo "    DB canquest_app dropped."
  sudo -u postgres psql -c "DROP USER IF EXISTS canquest;" && echo "    DB user canquest dropped."
else
  echo "    Skipped — database kept. Existing data will be reused on next deploy."
fi

echo ""
echo "==> [6/6] SSL certificates — optional cleanup"
echo ""
read -p "Remove Let's Encrypt SSL certificate for api.canquest.cc? [y/N] " DROP_SSL
if [[ "${DROP_SSL,,}" == "y" ]]; then
  certbot delete --cert-name api.canquest.cc 2>/dev/null && echo "    SSL cert removed." || echo "    WARN: certbot delete failed or cert not found."
else
  echo "    Skipped — SSL cert kept (certbot will reuse it on next deploy)."
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "  ✅  VPS 2 app layer wiped clean."
echo ""
echo "  Canton tunnel SSH key is still at /root/.ssh/canton_tunnel"
echo "  (kept so you don't need to re-add it to VPS 1)."
echo ""
echo "  Next steps:"
echo "    1. Push your updated code to GitHub"
echo "    2. Clone and run fresh deploy on VPS 2:"
echo "         git clone <YOUR_REPO> /var/www/canquest"
echo "         bash /var/www/canquest/infra/deploy.sh"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
