# CanQuest — deploy on VPS 2 (full stack)

> **Bahasa Indonesia:** panduan lengkap arsitektur VPS1/VPS2 + Vercel → [TUTORIAL_DEPLOY_INDONESIA.md](./TUTORIAL_DEPLOY_INDONESIA.md)

Run **website + API + database** on **VPS 2** (`62.171.185.56`).  
**Canton ledger + Splice validator** stay on a **separate validator VPS**; VPS 2 reaches them via **SSH tunnel** (localhost `7575` / `8080`).

> **Important:** VPS 2 IP is the **same** for DevNet, TestNet, and MainNet.  
> **Validator VPS IPs are different** per network. See [NETWORK_TOPOLOGY.md](./NETWORK_TOPOLOGY.md).

| Machine | Role |
|---------|------|
| **VPS 2** (`62.171.185.56`) | Nginx, Next.js `:3000`, Nest API `:3001`, Postgres, Redis — **fixed** |
| **Validator VPS** (IP **varies**) | Canton + Splice — e.g. TestNet `162.250.190.204`, **not** DevNet `162.250.191.46` |

---

## 1. DNS (when domain ready)

| Record | Type | Value |
|--------|------|--------|
| `canquest.cc` | A | `62.171.185.56` |
| `www.canquest.cc` | A | `62.171.185.56` |
| `api.canquest.cc` | A | `62.171.185.56` (optional if using single domain + `/api`) |

**Single-server layout** (recommended): one nginx config serves web + `/api` → see `infra/nginx/canquest.conf`.

---

## 2. First-time server setup (VPS 2)

```bash
# Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx docker.io docker-compose-plugin git
sudo npm install -g pm2

sudo mkdir -p /var/www/canquest
sudo chown $USER:$USER /var/www/canquest
cd /var/www/canquest
git clone <your-repo-url> .
```

---

## 3. Environment files

### API — `apps/api/.env`

Copy and edit:

```bash
cp infra/env/api.env.production.example apps/api/.env
nano apps/api/.env
```

Minimum to set:

- `DATABASE_URL` — strong Postgres password (match `docker-compose.yml` or your own Postgres)
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_JWT_SECRET` — random 64-char hex each
- `WEB_ORIGIN` — `https://canquest.cc` (or `http://62.171.185.56` for IP-only test)
- `TWITTERAPI_IO_KEY` — from [twitterapi.io dashboard](https://twitterapi.io/dashboard)
- `ADMIN_PANEL_EMAIL` / `ADMIN_PANEL_PASSWORD` — admin login
- `INVITE_CODES` — e.g. `CANQUEST` or empty
- Canton block — from validator VPS (see `docs/CANTON_TESTNET.md`):
  - `CANTON_SPLICE_SECRET`
  - `CANTON_VALIDATOR_PARTY_ID`, `CANTON_APP_PROVIDER_PARTY_ID`, `CANTON_OPERATOR_PARTY_ID`
  - `CANTON_JSON_API_URL=http://127.0.0.1:7575`
  - `CANTON_VALIDATOR_URL=http://127.0.0.1:8080`
  - `CANTON_VALIDATOR_HOST_HEADER=wallet.localhost`

Merge TestNet hints from `infra/env/api.env.testnet.example` if needed.

### Web — `apps/web/.env`

```bash
cp infra/env/web.env.production.example apps/web/.env
nano apps/web/.env
```

For **same VPS** (nginx proxies `/api`):

```env
NODE_ENV=production
INTERNAL_API_URL=http://127.0.0.1:3001/api
NEXT_PUBLIC_API_URL=https://canquest.cc/api
JWT_ACCESS_SECRET=<same as JWT_ACCESS_SECRET in apps/api/.env>
```

`JWT_ACCESS_SECRET` **must match** the API value.

---

## 4. Canton tunnel (VPS 2 → validator)

Pick the **validator IP for your network** (TestNet example below). Do not use DevNet `162.250.191.46` for TestNet/MainNet.

On **that validator VPS** (e.g. TestNet `162.250.190.204`), get Docker IPs:

```bash
docker inspect splice-validator-participant-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
docker inspect splice-validator-nginx-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
```

On **VPS 2**, install systemd unit:

```bash
sudo cp infra/systemd/canton-tunnel.service.example /etc/systemd/system/canton-tunnel.service
sudo nano /etc/systemd/system/canton-tunnel.service
# Replace PARTICIPANT_DOCKER_IP, NGINX_DOCKER_IP, and SSH user/host if needed

sudo systemctl daemon-reload
sudo systemctl enable --now canton-tunnel
curl -s http://127.0.0.1:7575/livez
```

Details: [CANTON_TESTNET.md](./CANTON_TESTNET.md).

---

## 5. Deploy / update app

```bash
cd /var/www/canquest
git pull

chmod +x scripts/deploy-vps2.sh
./scripts/deploy-vps2.sh --seed    # first time: creates quests + earn hub
# Later updates:
./scripts/deploy-vps2.sh
```

This will:

1. Start Postgres + Redis (Docker)
2. `npm ci`, Prisma push, build API + web
3. PM2: `canquest-api` + `canquest-web`

---

## 6. Nginx

```bash
sudo cp /var/www/canquest/infra/nginx/canquest.conf /etc/nginx/sites-available/canquest
sudo ln -sf /etc/nginx/sites-available/canquest /etc/nginx/sites-enabled/canquest
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Edit `server_name` in `canquest.conf` to your domain or IP.

HTTPS:

```bash
sudo certbot --nginx -d canquest.cc -d www.canquest.cc
```

---

## 7. Post-deploy checks

| Check | Command / URL |
|-------|----------------|
| API health | `curl http://127.0.0.1:3001/api/health` |
| Web | `curl -I http://127.0.0.1:3000` |
| Public site | `https://canquest.cc` |
| Quest hub | `https://canquest.cc/quest` |
| Earn campaigns | `https://canquest.cc/earn` |
| Admin | `https://canquest.cc/admin` |
| Ledger | `curl http://127.0.0.1:7575/livez` on VPS 2 |

### Earn menu empty?

1. Run seed once: `./scripts/deploy-vps2.sh --seed`
2. Or admin: login → **Quest** (earn hub) → ensure tasks exist
3. Or API: `POST /api/admin/earn-hub/ensure` (admin auth)

### Partner **Earn** campaigns

Create under **Admin → Earn** (`questKind = CAMPAIGN`). They appear on `/earn`, not `/quest`.

---

## 8. PM2 logs

```bash
pm2 logs canquest-api
pm2 logs canquest-web
pm2 restart all
```

---

## Architecture sketch

```
Internet → Nginx (80/443) on VPS 2
              ├─ /api/*  → Nest :3001 → Postgres / Redis
              └─ /*      → Next  :3000
Nest :3001 ──SSH tunnel──► Validator VPS :7575 (Canton) + :8080 (Splice)
```

---

*Old split setup (API-only on VPS 2 + Vercel web) used `infra/nginx/canquest-api.conf` — prefer `canquest.conf` for everything on VPS 2.*
