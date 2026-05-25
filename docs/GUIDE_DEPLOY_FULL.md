# CanQuest — full deployment guide (zero to production)

End-to-end setup: **VPS 1 (Canton validator)**, **VPS 2 (API + database)**, **WireGuard**, **Vercel (website)**.

> **Bahasa Indonesia (ringkas):** [TUTORIAL_DEPLOY_INDONESIA.md](./TUTORIAL_DEPLOY_INDONESIA.md)  
> **Network switching (TestNet → MainNet):** [NETWORK_TOPOLOGY.md](./NETWORK_TOPOLOGY.md)  
> **Canton validator details:** [CANTON_TESTNET.md](./CANTON_TESTNET.md) (same steps for MainNet, different IP/secrets)

---

## What you are building

```
Browser → https://www.canquest.cc (Vercel, Next.js)
              ↓ BFF /api/*
         https://api.canquest.cc (VPS 2, NestJS :3001)
              ↓ WireGuard (private)
         VPS 1 Docker: participant :7575 + Splice nginx :80
```

| Server | Example IP | Role | Stays same when switching network? |
|--------|------------|------|-------------------------------------|
| **VPS 2** | `62.171.185.56` | API, Postgres, Redis, WireGuard client | **Yes** |
| **VPS 1** | TestNet `162.250.190.204` / MainNet *your IP* | Canton + Splice validator only | **No** (new machine per network) |
| **Vercel** | CDN | Website UI | **Yes** (env vars only) |

**Never put `.env` files in Git.** Copy from `infra/env/*.example`.

---

## Phase 0 — Prerequisites

### Accounts & access

- [ ] GitHub repo access: `https://github.com/bangpateng/canquest.git`
- [ ] SSH root (or sudo) on VPS 1 and VPS 2
- [ ] Vercel account + domain `canquest.cc` (or your domain)
- [ ] [Resend](https://resend.com) API key (email OTP)
- [ ] [Cloudflare Turnstile](https://dash.cloudflare.com/) site + secret keys
- [ ] Optional: [twitterapi.io](https://twitterapi.io) key for X task verification

### Generate secrets (on your PC)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run **three times** → `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_JWT_SECRET` (all different).

### DNS records

| Record | Type | Target |
|--------|------|--------|
| `canquest.cc` | A or CNAME | Vercel (follow Vercel DNS instructions) |
| `www.canquest.cc` | CNAME | Vercel |
| `api.canquest.cc` | A | **`62.171.185.56`** (VPS 2) |

Use **one canonical** www vs apex (redirect the other) so login cookies are not lost.

---

## Phase 1 — VPS 1 (Canton validator node)

Install the **Splice validator** stack on VPS 1 using official docs for your network:

- **TestNet:** https://docs.test.global.canton.network.sync.global/validator_operator/validator_compose.html  
- **MainNet:** use the **production** Splice validator docs (not the TestNet URL).

### 1.1 Verify Docker is healthy

```bash
ssh root@<VPS1_IP>

docker ps --format 'table {{.Names}}\t{{.Status}}'

PARTICIPANT_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1)
NGINX_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-nginx-1)
DOCKER_SUBNET=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Subnet}}')

echo "PARTICIPANT_IP=$PARTICIPANT_IP"
echo "NGINX_IP=$NGINX_IP"
echo "DOCKER_SUBNET=$DOCKER_SUBNET"
```

**Write these down** — VPS 2 `apps/api/.env` will use `PARTICIPANT_IP` and `NGINX_IP`.

### 1.2 Health on VPS 1 (local)

```bash
curl -s -o /dev/null -w "participant: %{http_code}\n" http://${PARTICIPANT_IP}:7575/livez
curl -s -H "Host: wallet.localhost" -o /dev/null -w "splice: %{http_code}\n" http://127.0.0.1/api/validator/v0/version
```

Expect participant **200**; splice often **401** without JWT (API is up).

### 1.3 Collect Canton credentials (this network only)

```bash
docker exec splice-validator-validator-1 env | grep -iE 'secret|unsafe|audience'
curl -s -H "Host: wallet.localhost" http://127.0.0.1/api/validator/v0/admin/users/administrator
```

Save for VPS 2:

- `CANTON_SPLICE_SECRET`
- `CANTON_VALIDATOR_PARTY_ID`
- `CANTON_APP_PROVIDER_PARTY_ID` (often same as validator party)
- `CANTON_OPERATOR_PARTY_ID`

**Do not reuse** values from another network (DevNet / old TestNet host).

---

## Phase 2 — WireGuard (VPS 1 ↔ VPS 2)

CanQuest uses **WireGuard**, not SSH tunnel. Templates: `infra/wireguard/`.

### 2.1 Generate keys (once per server)

On **each** VPS:

```bash
umask 077
wg genkey | tee /etc/wireguard/private.key | wg pubkey > /etc/wireguard/public.key
cat /etc/wireguard/public.key   # share with the other VPS
```

### 2.2 VPS 1 — `/etc/wireguard/wg0.conf`

Based on `infra/wireguard/wg0-vps1.conf.example`:

```ini
[Interface]
Address = 10.66.66.1/24
ListenPort = 51820
PrivateKey = <VPS1_PRIVATE_KEY>

PostUp = sysctl -w net.ipv4.ip_forward=1
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -o docker0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o docker0 -j MASQUERADE

[Peer]
PublicKey = <VPS2_PUBLIC_KEY>
AllowedIPs = 10.66.66.2/32
```

```bash
chmod 600 /etc/wireguard/wg0.conf
systemctl enable --now wg-quick@wg0
```

Open UDP **51820** on VPS 1 firewall only if needed (restrict to VPS 2 IP `62.171.185.56`).

### 2.3 VPS 2 — `/etc/wireguard/wg0.conf`

Based on `infra/wireguard/wg0-vps2.conf.example`:

```ini
[Interface]
Address = 10.66.66.2/24
PrivateKey = <VPS2_PRIVATE_KEY>

[Peer]
PublicKey = <VPS1_PUBLIC_KEY>
Endpoint = <VPS1_PUBLIC_IP>:51820
AllowedIPs = 10.66.66.1/32, <DOCKER_SUBNET>
PersistentKeepalive = 25
```

Replace `<DOCKER_SUBNET>` with e.g. `172.18.0.0/16` from Phase 1.1.

```bash
chmod 600 /etc/wireguard/wg0.conf
systemctl enable --now wg-quick@wg0
```

### 2.4 Test from VPS 2

```bash
ping -c 2 10.66.66.1
curl -s http://<PARTICIPANT_IP>:7575/livez
curl -s -H "Host: wallet.localhost" http://<NGINX_IP>/api/validator/v0/version
```

All must succeed before continuing.

### 2.5 Disable SSH tunnel (if old setup exists)

```bash
systemctl disable --now canton-tunnel 2>/dev/null || true
```

API `.env` must **not** use `127.0.0.1:7575` when using WireGuard — use Docker IPs from Phase 1.1.

---

## Phase 3 — VPS 2 (application server)

**IP:** `62.171.185.56` — same for TestNet and MainNet.

### 3.1 Base packages

```bash
ssh root@62.171.185.56

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs nginx git postgresql redis-server
npm install -g pm2
```

### 3.2 Clone GitHub

```bash
mkdir -p /var/www/canquest
chown $USER:$USER /var/www/canquest
cd /var/www/canquest
git clone https://github.com/bangpateng/canquest.git .
git checkout master
```

### 3.3 PostgreSQL

```bash
sudo -u postgres psql << 'SQL'
CREATE USER canquest WITH PASSWORD 'YOUR_STRONG_PASSWORD';
CREATE DATABASE canquest_app OWNER canquest;
SQL
```

For a **fresh network** (MainNet), prefer a new DB name e.g. `canquest_mainnet` instead of reusing TestNet data.

### 3.4 API environment file

```bash
cp infra/env/api.env.production.example apps/api/.env
nano apps/api/.env
```

**Critical fields:**

```env
NODE_ENV=production
PORT=3001
WEB_ORIGIN=https://canquest.cc,https://www.canquest.cc

DATABASE_URL=postgresql://canquest:YOUR_STRONG_PASSWORD@localhost:5432/canquest_app

JWT_ACCESS_SECRET=<hex>
JWT_REFRESH_SECRET=<different hex>
ADMIN_JWT_SECRET=<different hex>

AUTH_REGISTER_SKIP_OTP=false
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL="CanQuest Verification <noreply@canquest.cc>"

REDIS_URL=redis://localhost:6379

# WireGuard → Docker on VPS 1 (NOT localhost)
CANTON_JSON_API_URL=http://<PARTICIPANT_IP>:7575
CANTON_VALIDATOR_URL=http://<NGINX_IP>:80
CANTON_VALIDATOR_HOST_HEADER=wallet.localhost

CANTON_SPLICE_SECRET=<from VPS 1>
CANTON_LEDGER_API_AUDIENCE=https://canton.network.global
CANTON_SPLICE_AUDIENCE=https://canton.network.global
CANTON_LEDGER_API_USER=ledger-api-user
CANTON_VALIDATOR_ADMIN_USER=administrator
CANTON_VALIDATOR_PARTY_ID=<from VPS 1>
CANTON_APP_PROVIDER_PARTY_ID=<from VPS 1>
CANTON_OPERATOR_PARTY_ID=<from VPS 1>

ADMIN_PANEL_EMAIL=admin@yourdomain.com
ADMIN_PANEL_PASSWORD=<strong>
TWITTERAPI_IO_KEY=<optional>
```

### 3.5 Prisma + seed

```bash
cd /var/www/canquest/apps/api
export PRISMA_CLIENT_ENGINE_TYPE=binary
export PRISMA_CLI_QUERY_ENGINE_TYPE=binary
npx prisma generate
npx prisma db push
# Type y if prompted about unique indexes
npx ts-node prisma/seed.ts
```

### 3.6 Upload DAML (tunnel/WG must reach participant)

```bash
cd /var/www/canquest
cd packages/daml && daml build
cd ../..
node apps/api/scripts/upload-daml-dar.cjs
cd packages/daml && daml damlc inspect-dar .daml/dist/canquest-0.1.1.dar
```

Copy package ID into `apps/api/.env`:

```env
CANTON_DAML_PACKAGE_ID=<64 hex from inspect-dar>
QUEST_LEDGER_ENABLED=true
FEATURED_APP_MARKERS_ENABLED=true
```

### 3.7 Build API + PM2

```bash
cd /var/www/canquest
npm ci
npm run build:api

mkdir -p logs
pm2 delete canquest-api 2>/dev/null || true
pm2 start infra/pm2.ecosystem.config.js --only canquest-api --env production
pm2 save
pm2 startup   # run the command it prints

curl -s http://127.0.0.1:3001/api/health
```

Expect JSON with API ok; check `auth.registerOtpRequired`, `resendConfigured`, `emailReady` if using OTP.

### 3.8 Nginx + HTTPS for API

```bash
cp /var/www/canquest/infra/nginx/canquest-api.conf /etc/nginx/sites-available/canquest-api
ln -sf /etc/nginx/sites-available/canquest-api /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nano /etc/nginx/sites-available/canquest-api   # confirm server_name api.canquest.cc

nginx -t
systemctl reload nginx

apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.canquest.cc

curl -s https://api.canquest.cc/api/health
```

---

## Phase 4 — Vercel (website)

### 4.1 Import project

1. Vercel → **Add New Project** → GitHub `canquest`
2. **Root Directory:** `apps/web`
3. Framework: Next.js (auto)

### 4.2 Production environment variables

| Variable | Value |
|----------|--------|
| `INTERNAL_API_URL` | `https://api.canquest.cc/api` |
| `JWT_ACCESS_SECRET` | **Exact copy** from VPS `apps/api/.env` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare site key |
| `TURNSTILE_SECRET_KEY` | Cloudflare secret |
| `NEXT_PUBLIC_API_URL` | `https://canquest.cc/api` (optional) |

### 4.3 Domains

- Add `canquest.cc` and `www.canquest.cc`
- Enable redirect so users always land on one hostname

### 4.4 Deploy

Push to `master` or click **Redeploy**. Wait until build succeeds.

---

## Phase 5 — Smoke test (production)

| Step | Action | Expected |
|------|--------|----------|
| 1 | `curl https://api.canquest.cc/api/health` | 200 JSON |
| 2 | Open `https://www.canquest.cc` | Site loads |
| 3 | Register + email OTP | Email received, verify works |
| 4 | Login | Redirect to `/overview` |
| 5 | **Quest** → daily check-in | Works **without** wallet |
| 6 | **Wallet** → create username | Real party ID (not `canquest:user:...`) |
| 7 | `GET` ledger / balance | CC balance loads |
| 8 | **Earn** / **Spin** | Require wallet (menu gate) |

---

## Phase 6 — Updates after `git push`

### On your PC

```bash
git add .
git commit -m "describe change"
git push origin master
```

### On VPS 2

```bash
cd /var/www/canquest
git pull --ff-only origin master

cd apps/api
export PRISMA_CLIENT_ENGINE_TYPE=binary
export PRISMA_CLI_QUERY_ENGINE_TYPE=binary
npx prisma generate
npx prisma db push

cd /var/www/canquest
npm ci
npm run build:api

pm2 delete canquest-api
pm2 start infra/pm2.ecosystem.config.js --only canquest-api --env production
pm2 save

curl -s http://127.0.0.1:3001/api/health
```

Always run `prisma generate` after pull if `schema.prisma` changed.

**Important:** `pm2 restart` alone may **not** reload `.env` changes. Use `pm2 delete` + `start` as above when editing `apps/api/.env`.

### On Vercel

Auto-deploy from GitHub, or manual **Redeploy** for env-only changes.

---

## Phase 7 — Switching TestNet → MainNet

1. New VPS 1 with MainNet Splice validator → new `PARTICIPANT_IP`, `NGINX_IP`, secrets.  
2. Update WireGuard **Endpoint** on VPS 2 to new VPS 1 IP; update **AllowedIPs** Docker subnet if changed.  
3. New database recommended (`canquest_mainnet`).  
4. Replace **all** `CANTON_*` in `apps/api/.env`.  
5. Re-upload DAR on MainNet participant → new `CANTON_DAML_PACKAGE_ID`.  
6. Rebuild API + PM2; Vercel unchanged except redeploy.

See [NETWORK_TOPOLOGY.md](./NETWORK_TOPOLOGY.md).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `502` on `api.canquest.cc` | `pm2 list`; `curl http://127.0.0.1:3001/api/health`; nginx SSL |
| Login `500` on website | Vercel missing `INTERNAL_API_URL` or wrong `JWT_ACCESS_SECRET` |
| `livez` fails from VPS 2 | WireGuard down; wrong `PARTICIPANT_IP`; NAT PostUp on VPS 1 |
| Wallet placeholder `canquest:user:...` | Splice unreachable — check `CANTON_VALIDATOR_URL` + Host header |
| OTP not sent | `AUTH_REGISTER_SKIP_OTP=false`, `RESEND_API_KEY`, reload PM2 env |
| Prisma `P1000` | `DATABASE_URL` password mismatch |
| Party ID from old account on wallet page | Sign out; hard refresh (session cache cleared on logout) |

**WireGuard debug:**

```bash
wg show
ping 10.66.66.1
curl http://<PARTICIPANT_IP>:7575/livez
```

**Canton connectivity script (from repo on VPS 2):**

```bash
cd /var/www/canquest
node apps/api/scripts/check-canton-connectivity.cjs
```

---

## Quick reference — file locations

| What | Path |
|------|------|
| API secrets | `/var/www/canquest/apps/api/.env` |
| Web (if on VPS) | `/var/www/canquest/apps/web/.env` |
| WireGuard | `/etc/wireguard/wg0.conf` |
| PM2 | `infra/pm2.ecosystem.config.js` |
| Nginx API | `infra/nginx/canquest-api.conf` |
| Env templates | `infra/env/*.example` |

---

## Related docs

- [ARCHITECTURE_LAYERS.md](./ARCHITECTURE_LAYERS.md)
- [CANTON_KONEKSI_VPS_GRPC_VS_JSON.md](./CANTON_KONEKSI_VPS_GRPC_VS_JSON.md) — WireGuard vs tunnel vs gRPC
- [VPS2_DEPLOY.md](./VPS2_DEPLOY.md) — `deploy-vps2.sh` one-shot script
- [EARN_PRODUCT_SPEC.md](./EARN_PRODUCT_SPEC.md) — Quest vs Earn product rules

---

*Last updated for: VPS 2 `62.171.185.56`, WireGuard, Vercel + API subdomain, TestNet validator example `162.250.190.204`.*
