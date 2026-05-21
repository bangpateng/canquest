# Panduan CanQuest — DevNet, TestNet & MainNet

Dokumen ini menjelaskan **apa yang berubah** ketika IP node validator Canton pindah (DevNet → TestNet → MainNet), dan **apa yang tidak perlu diubah**.

---

## Arsitektur (selalu sama)

```
┌─────────────────────────┐         SSH tunnel          ┌─────────────────────────┐
│  VPS 2 — App Server     │ ──────────────────────────► │  VPS 1 — Node Validator │
│  (Contabo / IP app)      │                             │  (IP node Canton)       │
│                         │                             │                         │
│  • NestJS API :3001     │   localhost:7575 ────────►  │  participant :7575      │
│  • PostgreSQL           │   localhost:8080 ────────►  │  nginx :80              │
│  • Redis                │   (Host: wallet.localhost)  │  Splice validator       │
│  • PM2                  │                             │  Docker stack           │
│  • Nginx → api.canquest  │                             │                         │
└─────────────────────────┘                             └─────────────────────────┘

Frontend (Vercel) ──HTTPS──► api.canquest.cc ──► VPS 2 API
```

| VPS | Peran | Yang di-install |
|-----|------|-----------------|
| **VPS 1** | Node validator Canton **saja** | Docker Splice + participant. **Jangan** pasang DB/API CanQuest di sini. |
| **VPS 2** | App CanQuest | Git repo `~/canquest`, PostgreSQL, Redis, PM2, tunnel ke VPS 1 |
| **Vercel** | Website | Next.js — env `NEXT_PUBLIC_API_URL` → API VPS 2 |

---

## Setup saat ini (DevNet — referensi)

| Item | Nilai contoh (sesuaikan IP kamu) |
|------|----------------------------------|
| VPS 1 (node) | `162.250.191.46` |
| VPS 2 (app) | IP server Contabo kamu (hostname `vmi3309107`) |
| Folder app di VPS 2 | `~/canquest` |
| Participant Docker IP | `172.19.0.5` |
| Tunnel ledger | `VPS2:7575 → 172.19.0.5:7575` |
| Tunnel Splice | `VPS2:8080 → 127.0.0.1:80` (nginx di VPS 1) |
| Host header Splice | `wallet.localhost` |
| API publik | `https://api.canquest.cc` |
| App publik | `https://app.canquest.cc` (Vercel) |

Dokumen terkait di repo:
- `infra/CANTON_TUNNEL_GUIDE.md` — detail tunnel SSH
- `infra/VPS-DEPLOYMENT.md` — deploy awal (beberapa path lama; pakai `~/canquest` di production)
- `infra/env/api.env.production.example` — template `.env` API

---

## Yang HARUS diubah saat pindah jaringan (TestNet / MainNet)

Hanya bagian **Canton / tunnel** — database & kode app **tetap di VPS 2**.

### A. Di VPS 1 (node baru) — baca saja, jangan rusak yang jalan

```bash
ssh root@IP_NODE_BARU

docker ps --format "table {{.Names}}\t{{.Status}}"
docker inspect -f '{{.Name}} → {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  $(docker ps -q) | grep -i participant
```

Catat:
- `PARTICIPANT_IP` (untuk tunnel port 7575)
- Pastikan stack Splice sudah jalan (participant + validator + nginx)

### B. Di VPS 2 — SSH key (sekali per node baru)

```bash
# Di VPS 2 — kalau belum punya key:
ssh-keygen -t ed25519 -f /root/.ssh/canton_tunnel -N ""

cat /root/.ssh/canton_tunnel.pub
# Copy public key ke VPS node baru:
# Di VPS 1: echo "PUBKEY" >> /root/.ssh/authorized_keys

# Tes:
ssh -i /root/.ssh/canton_tunnel root@IP_NODE_BARU echo OK
```

### C. Di VPS 2 — update `canton-tunnel.service`

```bash
sudo nano /etc/systemd/system/canton-tunnel.service
```

Ganti **hanya** IP host SSH dan IP participant jika berubah:

```ini
ExecStart=/usr/bin/ssh \
  -N \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -o StrictHostKeyChecking=accept-new \
  -o BatchMode=yes \
  -i /root/.ssh/canton_tunnel \
  -L 7575:PARTICIPANT_IP:7575 \
  -L 8080:127.0.0.1:80 \
  root@IP_NODE_BARU
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart canton-tunnel
systemctl status canton-tunnel
```

### D. Di VPS 2 — update `~/canquest/apps/api/.env`

| Variabel | DevNet (contoh) | TestNet / MainNet |
|----------|-----------------|-------------------|
| `CANTON_JSON_API_URL` | `http://127.0.0.1:7575` | **Sama** (lewat tunnel) |
| `CANTON_VALIDATOR_URL` | `http://127.0.0.1:8080` | **Sama** |
| `CANTON_VALIDATOR_HOST_HEADER` | `wallet.localhost` | Cek nginx `server_name` di node baru |
| `CANTON_SPLICE_SECRET` | dari node (sering `unsafe` di dev) | **Ambil dari node baru** |
| `CANTON_SPLICE_AUDIENCE` | `https://canton.network.global` | Biasanya sama; cek docs jaringan |
| `CANTON_LEDGER_API_AUDIENCE` | `https://canton.network.global` | Biasanya sama |
| `CANTON_LEDGER_API_USER` | `ledger-api-user` | Sesuaikan grant di participant |
| `CANTON_VALIDATOR_ADMIN_USER` | `administrator` | Sesuaikan setup Splice |
| `CANTON_VALIDATOR_PARTY_ID` | party validator lama | **Wajib ganti** — party ID baru |
| `LEDGER_INDEXER_PARTY_IDS` | party yang di-watch | Update jika pakai indexer |

Cara dapat nilai dari node (VPS 1):

```bash
# Secret (contoh)
docker exec splice-validator-validator-1 env | grep -iE "secret|unsafe|audience"

# Party ID validator
cd ~/canquest/apps/api
set -a && source .env && set +a
node scripts/get-validator-party-id.cjs
```

Restart API:

```bash
pm2 restart canquest-api --update-env
```

### E. Yang TIDAK perlu diubah saat pindah jaringan

- Kode repo CanQuest (kecuali fitur baru)
- `DATABASE_URL` (tetap PostgreSQL di VPS 2)
- `JWT_ACCESS_SECRET` (tetap, tapi **harus sama** dengan Vercel)
- Domain `api.canquest.cc` / `app.canquest.cc` (tetap arahkan ke VPS 2 + Vercel)
- Struktur PM2 (`infra/pm2.ecosystem.config.js`)

---

## Checklist verifikasi (setiap pindah IP / jaringan)

Jalankan di **VPS 2**:

```bash
cd ~/canquest/apps/api
set -a && source .env && set +a
node scripts/check-canton-connectivity.cjs
```

Harapan:
- Canton JSON API: ✅
- Splice Validator: ✅

Manual:

```bash
curl -s http://127.0.0.1:7575/livez          # HTTP 200
curl -s https://api.canquest.cc/api/health   # {"ok":true,...}
pm2 status                                    # canquest-api online
```

Tes di browser: register → buat wallet → cek saldo (butuh Splice OK).

---

## Perbandingan DevNet vs TestNet vs MainNet

| Aspek | DevNet | TestNet | MainNet |
|-------|--------|---------|---------|
| Tujuan | Development / uji coba | Pre-production | Production nyata |
| VPS node | IP dev kamu | IP testnet baru | IP mainnet baru |
| VPS app | Bisa sama (VPS 2) | Bisa sama atau VPS terpisah | **Disarankan** VPS app terpisah + backup |
| `CANTON_SPLICE_SECRET` | Sering `unsafe` | Dari operator / docs testnet | **Rahasia kuat** dari operator |
| CC / token | Test / faucet | Testnet CC | **CC nyata** — hati-hati reward & fee |
| Database | Boleh satu DB dev | DB terpisah disarankan | **DB production** terpisah |
| Invite register | `INVITE_CODES` longgar | Lebih ketat | **Wajib** invite + OTP production |
| `AUTH_REGISTER_SKIP_OTP` | `true` di dev | `false` | `false` |
| Backup | Opsional | Disarankan | **Wajib** (DB + .env) |

---

## Alur deploy pertama kali (VPS 2 — ringkas)

```bash
# 1. Clone & install
cd ~
git clone https://github.com/bangpateng/canquest.git
cd canquest
npm ci

# 2. Env & DB
cp infra/env/api.env.production.example apps/api/.env
nano apps/api/.env   # isi DATABASE_URL, JWT, Canton, dll.

cd apps/api
npx prisma generate
npx prisma db push
npm run build

# 3. PM2
cd ~/canquest
mkdir -p logs
pm2 start infra/pm2.ecosystem.config.js --only canquest-api --env production
pm2 save --force

# 4. Tunnel (setelah VPS 1 siap)
sudo cp infra/systemd/canton-tunnel.service /etc/systemd/system/
# edit IP participant + IP node
sudo systemctl enable --now canton-tunnel

# 5. Verifikasi
cd apps/api && set -a && source .env && set +a && node scripts/check-canton-connectivity.cjs
```

---

## Alur pindah DevNet → TestNet (contoh)

1. Pasang node **TestNet** di VPS 1 baru (atau reinstall stack dengan config testnet).
2. Catat `PARTICIPANT_IP` + `CANTON_VALIDATOR_PARTY_ID` + secret/audience testnet.
3. Di VPS 2: update `canton-tunnel.service` → IP node testnet.
4. Di VPS 2: update `apps/api/.env` (party ID, secret, audience jika beda).
5. **Opsional tapi disarankan:** database baru `canquest_app_testnet` agar data dev tidak tercampur.
6. `pm2 restart canquest-api --update-env`
7. Jalankan checklist verifikasi di atas.
8. Update Vercel env jika API domain / secret berubah.

---

## Alur pindah TestNet → MainNet

Sama seperti di atas, dengan tambahan:

- **Jangan** pakai database dev/testnet untuk mainnet.
- Generate JWT secret baru untuk production.
- Matikan `AUTH_REGISTER_SKIP_OTP`, aktifkan `RESEND_API_KEY` untuk OTP email.
- Set `INVITE_CODES` untuk registrasi tertutup.
- Review `TRANSACTION_FEE_CC` dan reward quest/spin (CC nyata).
- Pertimbangkan subdomain terpisah: `api-mainnet.canquest.cc` vs testnet.

---

## Vercel (frontend) — env yang harus cocok dengan VPS 2

| Variabel Vercel | Harus sama dengan |
|-----------------|-------------------|
| `JWT_ACCESS_SECRET` | `apps/api/.env` di VPS 2 |
| `NEXT_PUBLIC_API_URL` | `https://api.canquest.cc/api` |
| `INTERNAL_API_URL` | `https://api.canquest.cc/api` |

Setelah ubah `.env` di VPS 2, redeploy Vercel (push git atau manual redeploy).

---

## Troubleshooting cepat

| Gejala | Penyebab umum | Solusi |
|--------|---------------|--------|
| `7575/livez` kosong | Tunnel mati / IP participant salah | `systemctl restart canton-tunnel`, cek IP di VPS 1 |
| Splice 404 di `readyz` | Endpoint tidak ada | Normal; tes `/admin/users` dengan JWT |
| Wallet gagal | Secret/audience/party ID salah | Update `.env`, `pm2 restart` |
| API health OK, app error | JWT Vercel ≠ VPS | Samakan `JWT_ACCESS_SECRET` |
| PM2 crash platform-express | `node_modules` workspace | Pakai `infra/pm2.ecosystem.config.js` terbaru + `git pull` |

---

## Catatan keamanan

- **Jangan** commit `apps/api/.env` ke GitHub.
- **Jangan** paste isi `.env` di chat (password, JWT, secret Canton).
- Rotasi secret jika pernah bocor.
- VPS 1: hanya buka port SSH + firewall minimal; tidak perlu expose 7575/8080 ke publik (cukup tunnel dari VPS 2).

---

## Ringkasan satu kalimat

**IP node Canton berubah di VPS 1 → update tunnel + `.env` Canton di VPS 2 → restart PM2 → tes `check-canton-connectivity.cjs`.**  
Kode app, PostgreSQL, dan Vercel hanya disesuaikan secret/domain jika perlu — tidak perlu install ulang seluruh app kecuali mau environment DB terpisah per jaringan.

---

## CC & CIP-56 (Opsi B — TransferPreapproval)

Untuk kirim CC dari **wallet validator** ke user web **tanpa Accept manual**, ikuti:

**[`PANDUAN-CIP56-OPSION-B.md`](./PANDUAN-CIP56-OPSION-B.md)**

Ringkas:
1. User buat wallet + aktifkan preapproval (`POST /api/party/ensure-preapproval`)
2. Kirim dari Splice Wallet UI ke Party ID user
3. Set `CANTON_APP_PROVIDER_PARTY_ID` untuk app reward
