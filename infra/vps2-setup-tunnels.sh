#!/bin/bash
# =============================================================
# CanQuest — VPS 2: Setup persistent SSH tunnels to VPS 1
# Run this on VPS 2 once. It installs autossh systemd services
# so tunnels restart automatically on reboot/disconnect.
#
# Architecture:
#   VPS 1 (162.250.191.xx) = Canton validator node ONLY
#   VPS 2 (this server)    = API + Frontend + PostgreSQL + Redis
#
# Tunnels needed from VPS 2 → VPS 1:
#   Port 7575  → Canton JSON Ledger API (participant node)
#   Port 5003  → Splice Validator App API
# =============================================================

VPS1_IP="${VPS1_IP:-162.250.191.46}"   # Replace with your VPS 1 IP
VPS1_USER="${VPS1_USER:-root}"
SSH_KEY="${SSH_KEY:-/root/.ssh/id_ed25519}"

# ── Step 1: Install autossh ───────────────────────────────────
echo "[1/4] Installing autossh..."
apt-get install -y autossh 2>/dev/null || yum install -y autossh 2>/dev/null

# ── Step 2: Get Docker IPs from VPS 1 ────────────────────────
echo "[2/4] Fetching Docker container IPs from VPS 1..."
echo "  Run these commands on VPS 1 to get Docker IPs:"
echo "  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1"
echo "  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-validator-1"
echo ""
read -rp "Enter participant Docker IP (e.g. 172.18.0.5): " PARTICIPANT_IP
read -rp "Enter validator Docker IP (e.g. 172.18.0.6): " VALIDATOR_IP

# ── Step 3: Create systemd service for Ledger API tunnel ─────
echo "[3/4] Creating systemd tunnel services..."

cat > /etc/systemd/system/canton-tunnel-ledger.service << EOF
[Unit]
Description=SSH tunnel: VPS2 → VPS1 Canton JSON Ledger API (port 7575)
After=network.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/autossh -M 0 -N -o "ServerAliveInterval=30" -o "ServerAliveCountMax=3" \
  -o "StrictHostKeyChecking=no" -o "ExitOnForwardFailure=yes" \
  -i ${SSH_KEY} \
  -L 7575:${PARTICIPANT_IP}:7575 \
  ${VPS1_USER}@${VPS1_IP}
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/canton-tunnel-validator.service << EOF
[Unit]
Description=SSH tunnel: VPS2 → VPS1 Splice Validator API (port 5003)
After=network.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/autossh -M 0 -N -o "ServerAliveInterval=30" -o "ServerAliveCountMax=3" \
  -o "StrictHostKeyChecking=no" -o "ExitOnForwardFailure=yes" \
  -i ${SSH_KEY} \
  -L 5003:${VALIDATOR_IP}:5003 \
  ${VPS1_USER}@${VPS1_IP}
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF

# ── Step 4: Enable & start services ──────────────────────────
echo "[4/4] Enabling and starting tunnel services..."
systemctl daemon-reload
systemctl enable canton-tunnel-ledger canton-tunnel-validator
systemctl start canton-tunnel-ledger canton-tunnel-validator

sleep 3
echo ""
echo "── Tunnel Status ────────────────────────────────────"
systemctl status canton-tunnel-ledger --no-pager -l
systemctl status canton-tunnel-validator --no-pager -l
echo ""
echo "── Verify connectivity ───────────────────────────────"
echo "Ledger API:   curl -s http://127.0.0.1:7575/livez"
curl -s --max-time 5 http://127.0.0.1:7575/livez && echo " ✓ Ledger API reachable" || echo " ✗ Ledger API NOT reachable"
echo "Validator:    curl -s http://127.0.0.1:5003/api/validator/v0/admin/users"
curl -s --max-time 5 http://127.0.0.1:5003/api/validator/v0/admin/users > /dev/null && echo " ✓ Validator API reachable (got response)" || echo " ✗ Validator API NOT reachable"

echo ""
echo "✅ Setup complete!"
echo "   Update apps/api/.env with:"
echo "   CANTON_JSON_API_URL=http://127.0.0.1:7575"
echo "   CANTON_VALIDATOR_URL=http://127.0.0.1:5003"
