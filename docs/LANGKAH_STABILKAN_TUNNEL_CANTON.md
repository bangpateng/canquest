# Langkah demi langkah: stabilkan koneksi Canton (VPS 2 → VPS 1)

Panduan praktis **bahasa Indonesia**. CanQuest memakai **JSON Ledger API port 7575** (bukan gRPC `@daml/ledger`).

Jalankan perintah di **VPS 2** (`62.171.185.56`) kecuali bagian **VPS 1** disebutkan.

---

## Ringkasan hasil tes (dari PC dev)

| Tes | Hasil |
|-----|--------|
| `https://api.canquest.cc/api/health` | Jalankan di VPS / browser — lihat Langkah 7 |
| `npm run canton:check` di PC lokal | **Gagal** — normal, karena tunnel hanya ada di VPS 2 |

---

## Langkah 1 — Masuk ke VPS 2

```bash
ssh root@62.171.185.56
```

---

## Langkah 2 — Cek tunnel Canton sudah jalan

```bash
systemctl is-active canton-tunnel
```

Harapan: `active`

Kalau `inactive` atau `failed`:

```bash
journalctl -u canton-tunnel -n 50 --no-pager
```

---

## Langkah 3 — Tes JSON Ledger API (port 7575)

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:7575/livez
```

Harapan: **HTTP 200**

Kalau gagal (connection refused / timeout), lanjut Langkah 4–5.

---

## Langkah 4 — Ambil IP Docker di VPS 1 (validator TestNet)

**SSH ke VPS 1** (`162.250.190.204`):

```bash
ssh root@162.250.190.204
```

Cari IP participant dan nginx:

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}"
PARTICIPANT_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-participant-1)
NGINX_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' splice-validator-nginx-1)
echo "PARTICIPANT_IP=$PARTICIPANT_IP"
echo "NGINX_IP=$NGINX_IP"
curl -s "http://${PARTICIPANT_IP}:7575/livez"
```

Catat `PARTICIPANT_IP` dan `NGINX_IP` (contoh lama: `172.18.0.6` dan `172.18.0.7` — **bisa berubah** setelah restart Docker).

Keluar dari VPS 1: `exit`

---

## Langkah 5 — Perbaiki / buat service tunnel di VPS 2

Pastikan kunci SSH ke validator sudah ada:

```bash
# Di VPS 2 — sekali saja
test -f /root/.ssh/canquest_tunnel || ssh-keygen -t ed25519 -f /root/.ssh/canquest_tunnel -N ""
ssh-copy-id -i /root/.ssh/canquest_tunnel.pub root@162.250.190.204
```

Edit service (ganti `PARTICIPANT_IP` dan `NGINX_IP` dari Langkah 4):

```bash
sudo nano /etc/systemd/system/canton-tunnel.service
```

Isi minimal:

```ini
[Unit]
Description=SSH tunnel Canton JSON API (7575) + Splice nginx (8080)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/ssh -N \
  -i /root/.ssh/canquest_tunnel \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o TCPKeepAlive=yes \
  -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:7575:PARTICIPANT_IP:7575 \
  -L 127.0.0.1:8080:NGINX_IP:80 \
  root@162.250.190.204
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Aktifkan:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now canton-tunnel
curl -s http://127.0.0.1:7575/livez
```

---

## Langkah 6 — Tes Splice Validator API (port 8080)

```bash
curl -s -H "Host: wallet.localhost" -o /dev/null -w "HTTP %{http_code}\n" \
  http://127.0.0.1:8080/api/validator/v0/version
```

Harapan: **HTTP 200** (atau 401/403 — artinya koneksi jalan).

---

## Langkah 7 — Skrip cek lengkap (di VPS 2, dari folder project)

```bash
cd /var/www/canquest/apps/api
npm run canton:check
```

Harapan:

```
Canton JSON API:    ✅ OK
Splice Validator:   ✅ OK
```

---

## Langkah 8 — Pastikan `.env` API benar

```bash
nano /var/www/canquest/apps/api/.env
```

Minimal untuk tunnel:

```env
NODE_ENV=production
CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
CANTON_VALIDATOR_HOST_HEADER=wallet.localhost
CANTON_SPLICE_SECRET=unsafe
CANTON_LEDGER_API_USER=ledger-api-user
CANTON_LEDGER_API_AUDIENCE=https://canton.network.global
```

Restart API:

```bash
pm2 restart canquest-api --update-env
curl -s http://127.0.0.1:3001/api/health
curl -s https://api.canquest.cc/api/health
```

---

## Langkah 9 — Monitor otomatis (opsional, disarankan)

Buat cron agar tunnel di-restart jika `livez` mati:

```bash
sudo nano /etc/cron.d/canquest-tunnel-watch
```

Isi:

```cron
*/2 * * * * root curl -sf http://127.0.0.1:7575/livez >/dev/null || systemctl restart canton-tunnel
```

---

## Langkah 10 — Tes dari website (alur benar)

1. Buka `https://www.canquest.cc` — **bukan** IP validator.
2. Register / login.
3. Buka halaman Wallet → generate party (memanggil API VPS 2 → tunnel → VPS 1).

Browser **tidak** boleh mengakses `162.250.190.204:7575` langsung.

---

## Langkah 11 — Vercel (jika login gagal)

Di dashboard Vercel → Environment Variables:

| Variabel | Nilai |
|----------|--------|
| `INTERNAL_API_URL` | `https://api.canquest.cc/api` |
| `JWT_ACCESS_SECRET` | sama persis dengan VPS `apps/api/.env` |

Redeploy project web.

---

## Yang **tidak** perlu dilakukan (untuk CanQuest sekarang)

| Jangan | Alasan |
|--------|--------|
| `npm install @daml/ledger` | Legacy API, bukan Canton `/v2/` |
| Buka port gRPC 5011 ke internet | Default Canton gRPC = **5001**; CanQuest pakai JSON **7575** |
| `daml json-api` di VPS 2 | Participant VPS 1 sudah punya JSON API |
| Frontend tembak VPS 1 | Semua lewat `api.canquest.cc` |

Penjelasan lengkap: [CANTON_KONEKSI_VPS_GRPC_VS_JSON.md](./CANTON_KONEKSI_VPS_GRPC_VS_JSON.md)

---

## Checklist cepat

```bash
# Jalankan berurutan di VPS 2
systemctl is-active canton-tunnel
curl -sf http://127.0.0.1:7575/livez && echo "7575 OK"
curl -sf -H "Host: wallet.localhost" http://127.0.0.1:8080/api/validator/v0/version && echo "8080 OK"
cd /var/www/canquest/apps/api && npm run canton:check
pm2 list
curl -sf https://api.canquest.cc/api/health && echo "API publik OK"
```

Semua OK → koneksi stabil untuk production.
