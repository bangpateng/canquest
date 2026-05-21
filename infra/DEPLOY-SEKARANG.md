# Deploy CanQuest — Urutan Lengkap (Local → GitHub → VPS 2 → Vercel)

## Ringkasan 3 lingkungan

| Lingkungan | API | Web | Database | `.env` |
|------------|-----|-----|----------|--------|
| **Local** | `localhost:3001` | `localhost:3000` | Docker `canquest_dev` | `apps/api/.env` (laptop) |
| **Production** | `api.canquest.cc` | `app.canquest.cc` | VPS `canquest_app` | `~/canquest/apps/api/.env` (manual) |
| **GitHub** | Hanya **kode** | Auto Vercel | — | **Tidak** ikut push |

---

## STEP 1 — Local (sudah jalan)

```powershell
# Terminal A — tunnel (biarkan terbuka)
ssh -N -L 7575:172.19.0.5:7575 -L 8080:127.0.0.1:80 root@162.250.191.46

# Terminal B — DB
cd C:\Users\Bang Pateng\Documents\can
docker compose -f docker-compose.dev.yml up -d

# Terminal C — API
npm run dev:api

# Terminal D — Web
npm run dev:web
```

File: `apps/api/.env` → `NODE_ENV=development`, DB `canquest_dev`, Canton sama DevNet.

---

## STEP 2 — Push kode ke GitHub

```powershell
cd C:\Users\Bang Pateng\Documents\can
git add apps infra package-lock.json
git status
git commit -m "feat: CIP-56 preapproval, inbound CC sync, Canton env templates"
git push origin master
```

**Jangan** commit: `apps/api/.env`, file berisi password/JWT asli.

---

## STEP 3 — VPS 2 (API production)

SSH ke VPS app:

```bash
cd ~/canquest
git pull
npm ci
cd apps/api && npx prisma generate && npm run build
```

### Edit `.env` (manual — tidak dari git pull)

```bash
nano ~/canquest/apps/api/.env
```

Copy struktur dari `infra/env/api.env.vps-production.reference`  
Isi secret **dari VPS lama** (JWT, DATABASE_URL, admin password).

**Wajib untuk DevNet:**

```env
NODE_ENV=production
CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
CANTON_VALIDATOR_HOST_HEADER=wallet.localhost
CANTON_SPLICE_SECRET=unsafe
CANTON_LEDGER_API_AUDIENCE=https://canton.network.global
CANTON_SPLICE_AUDIENCE=https://validator.example.com
CANTON_VALIDATOR_ADMIN_USER=administrator
CANTON_LEDGER_API_USER=ledger-api-user
CC_INBOUND_SYNC_ENABLED=true
CC_INBOUND_SYNC_POLL_MS=30000
LEDGER_INDEXER_ENABLED=true
REDIS_URL=redis://localhost:6379
```

Restart:

```bash
cd ~/canquest
pm2 restart canquest-api --update-env
pm2 logs canquest-api --lines 30
```

Cek:

```bash
cd ~/canquest/apps/api
set -a && source .env && set +a
node scripts/check-canton-connectivity.cjs
curl -s https://api.canquest.cc/api/health
```

Pastikan tunnel aktif:

```bash
systemctl status canton-tunnel
```

---

## STEP 4 — Vercel (web)

Di Vercel → Project → Settings → Environment Variables:

| Key | Value |
|-----|--------|
| `JWT_ACCESS_SECRET` | **Sama persis** dengan `JWT_ACCESS_SECRET` di VPS `.env` |
| `NEXT_PUBLIC_API_URL` | `https://api.canquest.cc/api` |
| `INTERNAL_API_URL` | `https://api.canquest.cc/api` |

Redeploy setelah `git push`.

---

## Perbandingan Local vs VPS `.env`

| Variabel | Local | VPS |
|----------|-------|-----|
| `NODE_ENV` | `development` | `production` |
| `DATABASE_URL` | `...canquest_dev` | `...canquest_app` + password VPS |
| `JWT_*` | secret lokal | secret VPS (**beda**) |
| `CANTON_SPLICE_AUDIENCE` | `https://validator.example.com` | **sama** |
| `CANTON_VALIDATOR_HOST_HEADER` | `wallet.localhost` | **sama** |
| `CC_INBOUND_SYNC_ENABLED` | `true` | **sama** |
| `TRANSACTION_FEE_CC` | `2` | `3` (bebas) |

---

## Fitur setelah deploy

| Fitur | Cara kerja |
|-------|------------|
| Preapproval CIP-56 | Wallet → Aktifkan preapproval |
| Terima dari validator | Kirim ke Party ID (preapproval aktif) |
| User → user | Send CC (tanpa preapproval wajib) |
| History "CC received" | Auto sync saat saldo on-chain naik + buka Wallet |

---

## Dokumen terkait

- `infra/PANDUAN-CIP56-OPSION-B.md` — Opsi B / preapproval
- `infra/PANDUAN-JARINGAN-DEVNET-TESTNET-MAINNET.md` — pindah jaringan
- `infra/env/api.env.vps-production.reference` — template `.env` VPS
- `infra/env/api.env.production.example` — contoh umum
