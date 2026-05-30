# CanQuest — TestNet (validator VPS)

> **VPS 2** (`62.171.185.56`) stays the same across networks.  
> **This IP is only for TestNet validator** — DevNet/MainNet use other hosts. See [NETWORK_TOPOLOGY.md](./NETWORK_TOPOLOGY.md).

Validator TestNet IP: **`162.250.190.204`**

**Docker IPs (confirmed):**

| Container | IP |
|-----------|-----|
| `splice-validator-participant-1` | `172.18.0.5` (run `docker inspect` — may differ) |
| `splice-validator-nginx-1` | `172.18.0.7` |

Auth: `hs-256-unsafe`, `secret = "unsafe"` (typical TestNet compose).

Docs: [TestNet Splice](https://docs.test.global.canton.network.sync.global/) · [Validator Compose](https://docs.test.global.canton.network.sync.global/validator_operator/validator_compose.html)

---

## Arsitektur

```
PC / VPS App (CanQuest API)
    SSH tunnel localhost:7575, :8080
        → 162.250.190.204 (participant + nginx Splice)
```

API **selalu** pakai `http://127.0.0.1:7575` dan `http://127.0.0.1:8080` selama tunnel aktif — bukan IP publik langsung.

---

## 1. Di VPS validator (SSH ke 162.250.190.204)

```bash
ssh root@162.250.190.204

# Container
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# IP Docker (sesuaikan nama container jika beda)
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-nginx-1
# atau container nginx/proxy yang expose validator API

# Health di VPS
curl -s http://127.0.0.1:7575/livez
curl -s -H "Host: wallet.localhost" http://127.0.0.1/api/validator/v0/version
# atau port nginx internal yang dipakai compose Anda

# Secret JWT (hs-256-unsafe)
docker exec splice-validator-validator-1 env | grep -iE 'secret|unsafe|audience'

# Party IDs (pilih yang berhasil)
curl -s -H "Host: wallet.localhost" http://127.0.0.1/api/validator/v0/admin/users/administrator
# Jika 404: user belum ada — coba list users atau ambil dari ledger:
VALIDATOR_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-validator-1)
curl -s http://${VALIDATOR_IP}:5003/api/validator/v0/version
# Ledger parties (butuh JWT — lihat apps/api/scripts/check-canton-connectivity.cjs setelah tunnel)
```

Catat:

| Item | Nilai Anda |
|------|------------|
| `PARTICIPANT_IP` | `____________` |
| `NGINX_IP` | `____________` |
| `CANTON_SPLICE_SECRET` | `____________` |
| `CANTON_VALIDATOR_PARTY_ID` | `____________` |

---

## 2. Tunnel dari Windows (dev lokal)

Ganti `PARTICIPANT_IP` dan `NGINX_IP` dari langkah 1:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\tunnel-testnet.ps1 -ParticipantIp 172.18.0.5 -NginxIp 172.18.0.7
```

Setara manual:

```powershell
ssh -N -L 7575:172.18.0.5:7575 -L 8080:172.18.0.7:80 root@162.250.190.204
```

Verifikasi (terminal lain):

```powershell
curl http://127.0.0.1:7575/livez
curl -H "Host: wallet.localhost" http://127.0.0.1:8080/api/validator/v0/version
```

---

## 3. `apps/api/.env` (TestNet)

Salin dari `infra/env/api.env.testnet.example` atau set:

```env
CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
CANTON_VALIDATOR_HOST_HEADER=wallet.localhost

CANTON_SPLICE_SECRET=<dari validator TestNet>
CANTON_LEDGER_API_AUDIENCE=https://canton.network.global
CANTON_SPLICE_AUDIENCE=https://canton.network.global
CANTON_LEDGER_API_USER=ledger-api-user
CANTON_VALIDATOR_ADMIN_USER=administrator

CANTON_VALIDATOR_PARTY_ID=<party TestNet>
CANTON_APP_PROVIDER_PARTY_ID=<sama dengan validator party atau party app>
CANTON_OPERATOR_PARTY_ID=<party operator TestNet>

# Setelah upload DAR ke participant TestNet
CANTON_DAML_PACKAGE_ID=<64 hex dari daml build>
```

**Jangan** pakai party ID / package ID dari DevNet lama (`162.250.191.46`).

---

## 4. Upload DAR (tunnel harus hidup)

```bash
cd packages/daml && daml build
cd ../..
node apps/api/scripts/upload-daml-dar.cjs
cd packages/daml && daml damlc inspect-dar .daml/dist/canquest-0.1.1.dar
```

Isi `CANTON_DAML_PACKAGE_ID` (contoh build `canquest-0.1.1`):

```env
CANTON_DAML_PACKAGE_ID=8c0c659cb1a9a21ac71712bc8890561edbecee3fb7a952b4a65f24f94cc67dbb
```

→ restart API.

---

## 5. Database

TestNet = jaringan baru. Disarankan:

- DB dev terpisah: `canquest_testnet`, atau
- Reset user lama agar mereka **buat wallet baru** (party ID baru).

---

## 6. Smoke test

1. `npm run start:dev` di `apps/api` (tunnel + postgres + redis).
2. Register / login → Wallet → reserve username.
3. `GET /api/party/ledger-status` → canton + splice reachable.
4. Transfer kecil antar user → cek transaksi.
5. Log API: `FeaturedAppActivityMarker created` (jika `CANTON_APP_PROVIDER_PARTY_ID` terisi).

---

## 7. Production (VPS app + tunnel systemd)

Di VPS yang menjalankan CanQuest API, tunnel ke `162.250.190.204` (bukan IP publik ke 7575). Lihat `infra/env/api.env.production.example` — ganti host tunnel ke IP TestNet ini.

---

## Troubleshooting

| Gejala | Cek |
|--------|-----|
| `livez` gagal | Tunnel mati atau `PARTICIPANT_IP` salah |
| Validator 401/403 | `CANTON_SPLICE_SECRET` / audience salah |
| Validator 404 / HTML | Tambah `CANTON_VALIDATOR_HOST_HEADER=wallet.localhost` |
| Wallet placeholder `canquest:user:...` | Splice tidak reachable |
| Transfer gagal | Saldo CC TestNet, preapproval, tunnel 8080 |
| User party `::12200dd7…` bukan `::1220cc5c…` | Tunnel **7575** ke participant **salah** (DevNet / container lain). Jalankan `node apps/api/scripts/diagnose-participant-suffix.cjs` — suffix user harus sama dengan `CANTON_VALIDATOR_PARTY_ID` |

---

*IP DevNet lama di repo: `162.250.191.46` — jangan dipakai untuk TestNet.*
