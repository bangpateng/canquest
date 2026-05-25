# CanQuest — Tutorial arsitektur & deploy (Bahasa Indonesia)

Panduan lengkap: **VPS 1 (node Canton)**, **VPS 2 (API + database)**, **Vercel (website)**.

> **Panduan full dari nol (English, WireGuard + Vercel + clone GitHub):** [GUIDE_DEPLOY_FULL.md](./GUIDE_DEPLOY_FULL.md)

Dokumen teknis pendukung (English):

- [NETWORK_TOPOLOGY.md](./NETWORK_TOPOLOGY.md) — IP per jaringan (DevNet / TestNet / MainNet)
- [CANTON_TESTNET.md](./CANTON_TESTNET.md) — detail node TestNet
- [VPS2_DEPLOY.md](./VPS2_DEPLOY.md) — deploy VPS (English)

---

## 1. Gambaran arsitektur

### Tiga lapisan

```
┌──────────────────────────────────────────────────────────────────┐
│  PENGGUNA (browser)                                              │
│  https://canquest.cc  atau  https://www.canquest.cc              │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  VERCEL — Website (Next.js)                                      │
│  • Tampilan UI, halaman /quest, /earn, login                     │
│  • Route /api/* di Vercel = proxy ke backend (BFF)               │
│  • Env: INTERNAL_API_URL, JWT_ACCESS_SECRET                      │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  VPS 2 — App server (IP tetap: 62.171.185.56)                    │
│  • api.canquest.cc → NestJS API (:3001)                          │
│  • Postgres (canquest_testnet) + Redis                           │
│  • SSH tunnel → VPS 1                                            │
│  • File: /var/www/canquest/apps/api/.env                         │
└────────────────────────────┬─────────────────────────────────────┘
                             │ SSH tunnel (private)
                             │ localhost:7575 → participant
                             │ localhost:8080 → splice nginx
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  VPS 1 — Node validator (IP berganti per network)                │
│  TestNet contoh: 162.250.190.204                                 │
│  • Canton participant + Splice validator (Docker)                │
│  • Bukan tempat website / database aplikasi                      │
└──────────────────────────────────────────────────────────────────┘
```

### Peran masing-masing server

| Server | IP contoh | Fungsi | Jangan taruh di sini |
|--------|-----------|--------|----------------------|
| **VPS 1** | `162.250.190.204` (TestNet) | Node Canton + Splice saja | Website, Postgres app, PM2 web |
| **VPS 2** | `62.171.185.56` | API, DB, Redis, tunnel | Full node validator (berat) |
| **Vercel** | (CDN) | Website `canquest.cc` | Secret production DB |

### Alur request (yang benar)

1. Browser buka `https://www.canquest.cc`.
2. Login: `POST www.canquest.cc/api/auth/login` → **Vercel** memanggil `https://api.canquest.cc/api/auth/login` → **VPS 2**.
3. Quest / wallet: sama — browser **hanya** ke domain website; VPS 2 yang bicara ke Canton lewat tunnel.
4. Browser **tidak pernah** langsung ke IP VPS 1.

---

## 2. Cara VPS 2 bicara ke VPS 1 (sekarang vs nanti)

### Yang dipakai CanQuest sekarang (disarankan)

| Layanan | Protokol | Di VPS 2 | Di VPS 1 (Docker) |
|---------|----------|----------|-------------------|
| Ledger (party, quest, DAML) | HTTP **JSON Ledger API v2** | `127.0.0.1:7575` | participant `:7575` |
| Wallet / transfer Splice | HTTP **Validator API** | `127.0.0.1:8080` | nginx `:80` |

Koneksi: **SSH tunnel** (`canton-tunnel.service`) + env:

```env
CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
CANTON_VALIDATOR_HOST_HEADER=wallet.localhost
```

Kode: `apps/api/src/canton/canton-ledger.service.ts` (HTTP fetch, bukan gRPC mentah).

### Opsi masa depan: gRPC + `@daml/ledger`

Beberapa dokumentasi Canton menyarankan:

- Buka port gRPC (mis. `5011`) di VPS 1, firewall hanya dari IP VPS 2.
- Install `@daml/ledger` di backend dengan **keep-alive**.

Itu **jalur alternatif**, bukan wajib. Butuh refactor kode. Splice wallet API (`:8080`) tetap diperlukan terpisah.

**Kapan pertimbangkan gRPC:** traffic sangat tinggi, banyak subscription/stream ledger, tunnel sering putus meski sudah systemd.

---

## 3. File `.env` — di mana?

| Lingkungan | Lokasi | Isi utama |
|------------|--------|-----------|
| **PC (dev)** | `apps/api/.env` | DB lokal, tunnel manual, Canton TestNet |
| **PC (dev)** | `apps/web/.env` | Opsional untuk `next dev` |
| **VPS 2 (production API)** | `/var/www/canquest/apps/api/.env` | DB, JWT, Canton, `WEB_ORIGIN` |
| **Vercel (production web)** | Dashboard Vercel → Environment Variables | `INTERNAL_API_URL`, `JWT_ACCESS_SECRET` |

**Tidak masuk Git:** semua file `.env` (ada di `.gitignore`).

### VPS 2 — `apps/api/.env` (contoh TestNet)

```env
NODE_ENV=production
PORT=3001

DATABASE_URL=postgresql://canquest:PASSWORD@localhost:5432/canquest_testnet
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

JWT_ACCESS_SECRET=<64+ hex, random>
JWT_REFRESH_SECRET=<beda dari access>
ADMIN_JWT_SECRET=<beda lagi>

WEB_ORIGIN=https://canquest.cc,https://www.canquest.cc
AUTH_REGISTER_SKIP_OTP=true
INVITE_CODES=CANQUEST

CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
CANTON_VALIDATOR_HOST_HEADER=wallet.localhost
# + CANTON_SPLICE_SECRET, party IDs, CANTON_DAML_PACKAGE_ID dari VPS 1 TestNet
```

### Vercel — Environment Variables (Production)

```env
INTERNAL_API_URL=https://api.canquest.cc/api
JWT_ACCESS_SECRET=<SAMA PERSIS dengan VPS apps/api/.env>
```

Opsional: `NEXT_PUBLIC_API_URL=https://canquest.cc/api`

**Penting:** Tanpa `INTERNAL_API_URL`, login dari website akan error 500 (Vercel mencoba `localhost:3001`).

---

## 4. DNS

| Record | Type | Value |
|--------|------|--------|
| `canquest.cc` | A | `62.171.185.56` (Vercel: ikuti instruksi Vercel) |
| `www.canquest.cc` | A / CNAME | Vercel |
| `api.canquest.cc` | A | `62.171.185.56` (VPS 2, untuk API) |

Website di **Vercel**; subdomain **api** mengarah ke **VPS 2**.

---

## 5. Setup VPS 1 (node TestNet)

### 5.1 Persyaratan

- Ubuntu + Docker (Splice validator compose).
- IP TestNet contoh: `162.250.190.204` (ganti jika network lain — lihat [NETWORK_TOPOLOGY.md](./NETWORK_TOPOLOGY.md)).

### 5.2 Cek node sehat

SSH ke VPS 1:

```bash
# Participant (via IP Docker, bukan localhost)
PARTICIPANT_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1)
NGINX_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-nginx-1)

curl -s -o /dev/null -w "participant livez: %{http_code}\n" http://${PARTICIPANT_IP}:7575/livez
curl -s -H "Host: wallet.localhost" -o /dev/null -w "splice: %{http_code}\n" http://127.0.0.1/api/validator/v0/admin/users
```

Harapan: `participant livez: 200`, splice: `401` (butuh JWT — artinya API hidup).

### 5.3 SSH: izinkan VPS 2 masuk

Di VPS 1, tambahkan **public key** dari VPS 2 (`/root/.ssh/canquest_tunnel.pub`) ke `/root/.ssh/authorized_keys`.

Pastikan:

```bash
grep PubkeyAuthentication /etc/ssh/sshd_config
# PubkeyAuthentication yes
```

### 5.4 PubkeyAuthentication

Jika login key dari VPS 2 gagal, set `PubkeyAuthentication yes` dan `systemctl reload ssh`.

---

## 6. Setup VPS 2 (API + database)

### 6.1 Paket dasar

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git postgresql redis-server
sudo npm install -g pm2
```

Postgres & Redis: pakai **service systemd** (bukan Docker) jika port `5432` / `6379` sudah dipakai.

### 6.2 Clone repo

```bash
sudo mkdir -p /var/www/canquest
sudo chown $USER:$USER /var/www/canquest
cd /var/www/canquest
git clone https://github.com/bangpateng/canquest.git .
```

### 6.3 Upload `.env` API

Dari PC:

```powershell
scp apps/api/.env root@62.171.185.56:/var/www/canquest/apps/api/.env
```

Edit `DATABASE_URL` agar cocok dengan Postgres di VPS.

### 6.4 Database

```bash
sudo -u postgres psql << 'SQL'
CREATE USER canquest WITH PASSWORD 'PASSWORD_KAMU';
CREATE DATABASE canquest_testnet OWNER canquest;
SQL
```

```bash
cd /var/www/canquest/apps/api
export PRISMA_CLIENT_ENGINE_TYPE=binary
export PRISMA_CLI_QUERY_ENGINE_TYPE=binary
npm run prisma:generate
npm run prisma:push
# Ketik y jika ada warning unique twitterUsername
npx ts-node prisma/seed.ts
```

### 6.5 SSH tunnel (systemd)

Di VPS 2, buat key (sekali):

```bash
ssh-keygen -t ed25519 -f /root/.ssh/canquest_tunnel -N ""
ssh-copy-id -i /root/.ssh/canquest_tunnel.pub root@162.250.190.204
```

Ganti IP Docker dari VPS 1, lalu:

```bash
sudo nano /etc/systemd/system/canton-tunnel.service
```

```ini
[Unit]
Description=SSH tunnel Canton TestNet
After=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/ssh -N \
  -i /root/.ssh/canquest_tunnel \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:7575:PARTICIPANT_IP:7575 \
  -L 127.0.0.1:8080:NGINX_IP:80 \
  root@162.250.190.204
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now canton-tunnel
curl -s http://127.0.0.1:7575/livez
curl -s -H "Host: wallet.localhost" -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/api/validator/v0/admin/users
```

### 6.6 Build & PM2 (API saja — web di Vercel)

```bash
cd /var/www/canquest
npm ci
npm run build:api
pm2 start infra/pm2.ecosystem.config.js --only canquest-api --env production
pm2 save
curl -s http://127.0.0.1:3001/api/health
```

### 6.7 Nginx + HTTPS untuk API

```bash
sudo cp /var/www/canquest/infra/nginx/canquest-api.conf /etc/nginx/sites-available/canquest-api
sudo ln -sf /etc/nginx/sites-available/canquest-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo certbot --nginx -d api.canquest.cc
sudo nginx -t && sudo systemctl reload nginx
curl -s https://api.canquest.cc/api/health
```

---

## 7. Setup Vercel (website)

1. Connect repo GitHub → project dengan **Root Directory** `apps/web`.
2. Environment Variables (Production):
   - `INTERNAL_API_URL=https://api.canquest.cc/api`
   - `JWT_ACCESS_SECRET` = copy dari VPS `apps/api/.env`
3. Domain: `canquest.cc`, `www.canquest.cc` → Vercel.
4. Redirect `www` ↔ apex (satu canonical) agar cookie login tidak hilang.
5. Deploy / Redeploy.

---

## 8. Update kode setelah `git push`

### Di PC

```bash
git add .
git commit -m "feat: ..."
git push origin master
```

### Di VPS 2

```bash
cd /var/www/canquest
git pull origin master

cd apps/api
export PRISMA_CLIENT_ENGINE_TYPE=binary
export PRISMA_CLI_QUERY_ENGINE_TYPE=binary
npm run prisma:generate
npm run prisma:push

cd /var/www/canquest
npm ci
npm run build:api
pm2 restart canquest-api --update-env
```

**Selalu** `prisma generate` setelah pull jika schema berubah.

### Di Vercel

Auto-deploy dari GitHub, atau manual Redeploy.

---

## 9. Checklist production

| Cek | Perintah / tempat |
|-----|-------------------|
| Tunnel aktif | `systemctl is-active canton-tunnel` |
| Ledger | `curl http://127.0.0.1:7575/livez` → 200 |
| API lokal | `curl http://127.0.0.1:3001/api/health` |
| API publik | `curl https://api.canquest.cc/api/health` |
| PM2 | `pm2 list` → `canquest-api` online |
| Vercel env | `INTERNAL_API_URL` + `JWT_ACCESS_SECRET` |
| Login web | Register → login → `/api/me` → 200 |

---

## 10. Troubleshooting

### `502 Bad Gateway` di api.canquest.cc

- API tidak jalan: `pm2 list`, `curl http://127.0.0.1:3001/api/health`
- HTTPS belum aktif: `ss -tlnp | grep 443`, jalankan `certbot`
- Nginx belum enable: `ls /etc/nginx/sites-enabled/`

### Login website `500`

- Vercel tanpa `INTERNAL_API_URL`
- HTTPS api.canquest.cc mati
- Lihat Vercel → Logs

### Login `401 Invalid credentials`

- User belum register (DB pernah di-reset)
- Password salah
- `AUTH_REGISTER_SKIP_OTP=false` tapi email belum verifikasi OTP

### `/api/me` `401`

- Belum login / cookie `cq_access` tidak ada
- `JWT_ACCESS_SECRET` Vercel ≠ VPS
- Login di `canquest.cc` tapi buka `www` (atau sebaliknya) tanpa redirect

### Prisma `P1000` authentication failed

- `DATABASE_URL` di `.env` tidak cocok dengan password Postgres
- Jalankan `ALTER USER canquest WITH PASSWORD '...'`

### Build error `questKind does not exist`

- Lupa `npm run prisma:generate` setelah `git pull`

### `prisma db push` warning `twitterUsername`

- Ketik `y` jika tidak ada duplikat username

### Tunnel `Address already in use`

```bash
systemctl stop canton-tunnel
fuser -k 7575/tcp 8080/tcp
systemctl start canton-tunnel
```

---

## 11. Roadmap (fase)

| Fase | Isi |
|------|-----|
| **1 (sekarang)** | Tunnel + JSON API + Vercel + TestNet |
| **2** | Upload DAR, party TestNet, tes wallet & quest |
| **3** | Monitor tunnel, backup DB, `NODE_ENV=production` |
| **4 (opsional)** | VPN privat VPS2↔VPS1, atau gRPC (refactor besar) |

---

## 12. Ringkasan satu kalimat

**VPS 1 = node Canton; VPS 2 = otak aplikasi (API + DB) yang menghubungi node lewat tunnel; Vercel = muka website; file rahasia di `.env` VPS dan panel Vercel, bukan di GitHub.**

---

*Terakhir diperbarui: sesuai setup TestNet `162.250.190.204` + VPS app `62.171.185.56`.*
