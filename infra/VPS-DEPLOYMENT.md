# CanQuest — VPS Deployment Guide

## Architecture Overview

```
┌──────────────────────┐         ┌──────────────────────┐
│      VPS 1           │         │      VPS 2           │
│  (Canton Node Only)  │◄────────│  (App Server)        │
│                      │ SSH     │                      │
│  • Participant node  │ Tunnels │  • NestJS API (3001) │
│  • Splice Validator  │         │  • Next.js Web (3000)│
│  • Sequencer/Mediator│         │  • PostgreSQL (5432) │
│                      │ Port    │  • Redis (6379)      │
│  Port 7575 (Ledger)  │ 7575    │                      │
│  Port 5003 (Splice)  │ 5003    │                      │
└──────────────────────┘         └──────────────────────┘
```

> **VPS 1 IP:** `162.250.191.46` — Canton node ONLY  
> **VPS 2 IP:** Your app server — API + Frontend + DB

---

## VPS 1 — Canton Validator Node

VPS 1 **only** runs the validator. Nothing else should be installed here.

### Get Docker Container IPs (run on VPS 1)

```bash
# Get participant container IP (for port 7575)
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1

# Get validator container IP (for port 5003)
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-validator-1
```

Note these IPs — you'll need them when setting up tunnels on VPS 2.

---

## VPS 2 — App Server Setup

### 1. Install dependencies

```bash
apt-get update && apt-get install -y nodejs npm postgresql redis autossh git nginx
# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

### 2. Setup SSH tunnels (persistent)

```bash
# Run the setup script (fills in Docker IPs interactively)
bash infra/vps2-setup-tunnels.sh

# Verify tunnels work
curl http://127.0.0.1:7575/livez          # Should return HTTP 200
curl http://127.0.0.1:5003/api/validator/v0/admin/users  # Should return JSON
```

### 3. Setup PostgreSQL

```bash
sudo -u postgres psql << 'EOF'
CREATE USER canquest WITH PASSWORD 'YOUR_STRONG_PASSWORD';
CREATE DATABASE canquest_app OWNER canquest;
GRANT ALL PRIVILEGES ON DATABASE canquest_app TO canquest;
EOF
```

### 4. Configure apps/api/.env

Copy `apps/api/env.example.txt` to `apps/api/.env` and fill in:

```env
DATABASE_URL="postgresql://canquest:YOUR_STRONG_PASSWORD@localhost:5432/canquest_app"
JWT_ACCESS_SECRET="<generate: openssl rand -hex 32>"
JWT_REFRESH_SECRET="<generate: openssl rand -hex 32>"
CANTON_JSON_API_URL="http://127.0.0.1:7575"
CANTON_VALIDATOR_URL="http://127.0.0.1:5003"
CANTON_SPLICE_SECRET="unsafe"
CANTON_SPLICE_AUDIENCE="https://validator.example.com"
CANTON_VALIDATOR_ADMIN_USER="administrator"
CANTON_VALIDATOR_PARTY_ID=""  # Fill after step 5
```

### 5. Get Validator Party ID

```bash
cd apps/api
npm run canton:get-validator-party
# Copy the party_id output into CANTON_VALIDATOR_PARTY_ID in .env
```

### 6. Run DB migrations

```bash
cd apps/api
npm install
npm run prisma:push
```

### 7. Build & start API

```bash
cd apps/api
npm run build
# For production with PM2:
npm install -g pm2
pm2 start dist/main.js --name canquest-api
pm2 save
pm2 startup
```

### 8. Configure apps/web/.env.local

```env
INTERNAL_API_URL="http://localhost:3001/api"
JWT_ACCESS_SECRET="<same as API>"
NEXT_PUBLIC_APP_URL="https://app.canquest.com"
```

### 9. Build & start Next.js

```bash
cd apps/web
npm install
npm run build
pm2 start npm --name canquest-web -- start
pm2 save
```

### 10. Nginx reverse proxy

```nginx
# /etc/nginx/sites-available/canquest-api
server {
    listen 80;
    server_name api.canquest.com;
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# /etc/nginx/sites-available/canquest-app
server {
    listen 80;
    server_name app.canquest.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/canquest-api /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/canquest-app /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
# Then add SSL with certbot
certbot --nginx -d api.canquest.com -d app.canquest.com
```

---

## Verify Everything

```bash
# Check Canton connectivity
cd apps/api && npm run canton:check

# Check API health
curl http://localhost:3001/api/health

# Check web app
curl http://localhost:3000
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Canton JSON API NOT reachable` | `systemctl restart canton-tunnel-ledger` |
| `Splice Validator NOT reachable` | `systemctl restart canton-tunnel-validator` |
| `Database connection failed` | Check `DATABASE_URL`, ensure PostgreSQL running |
| `JWT invalid` | Ensure `JWT_ACCESS_SECRET` same in API and Web `.env` |
| `Party ID is placeholder` | Both tunnels must be active when creating wallet |
| `Balance shows null` | Tunnel to port 5003 must be active; check `CANTON_SPLICE_SECRET` |
