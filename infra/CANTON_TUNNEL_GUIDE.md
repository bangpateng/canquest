# Canton SSH Tunnel Guide
## Mengganti VPS Node Validator (Testnet → Mainnet atau IP Baru)

Panduan ini digunakan ketika kamu pindah node validator ke IP baru
(misalnya dari testnet ke mainnet, atau ganti VPS).

---

## Arsitektur Tunnel

```
VPS 2 (62.171.185.56) — App Server
  └── SSH Tunnel ──► VPS Node Validator
                        ├── :7575 → Canton participant (JSON Ledger API)
                        └── :80   → Splice nginx (validator onboarding)
```

---

## Langkah 1 — Cek IP Docker di VPS Node Baru

Masuk ke VPS node validator baru:
```bash
ssh root@IP_VPS_NODE_BARU
```

Lihat container yang berjalan:
```bash
docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
```

Cari nama container:
- `*participant*` → untuk port 7575 (Canton JSON Ledger API)
- `*nginx*`       → untuk port 80 (Splice nginx)

Ambil IP Docker masing-masing:
```bash
docker inspect -f '{{.Name}} → {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  $(docker ps -q)
```

Catat:
- `PARTICIPANT_IP` = IP container participant (contoh: `172.19.0.5`)
- `NGINX_IP`       = IP container nginx (contoh: `172.19.0.7`)

---

## Langkah 2 — Tambahkan SSH Key VPS 2 ke VPS Node Baru

Public key VPS 2 (tidak berubah):
```bash
# Jalankan di VPS 2:
cat /root/.ssh/canton_tunnel.pub
```

Tambahkan ke VPS node baru:
```bash
# Jalankan di VPS Node Baru:
echo "ISI_PUBLIC_KEY_DISINI" >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# Pastikan PubkeyAuthentication aktif:
grep "PubkeyAuthentication" /etc/ssh/sshd_config
# Kalau hasilnya "no", ubah:
sed -i 's/PubkeyAuthentication no/PubkeyAuthentication yes/' /etc/ssh/sshd_config
systemctl restart sshd
```

Test dari VPS 2 (tanpa password):
```bash
ssh -i /root/.ssh/canton_tunnel root@IP_VPS_NODE_BARU echo "CONNECTED"
```

---

## Langkah 3 — Update Tunnel Service di VPS 2

```bash
# Jalankan di VPS 2:
nano /etc/systemd/system/canton-tunnel.service
```

Update bagian `ExecStart`, ganti IP dan host:
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
  -L 8080:NGINX_IP:80 \
  root@IP_VPS_NODE_BARU
```

Reload dan restart:
```bash
systemctl daemon-reload
systemctl restart canton-tunnel
sleep 5
systemctl status canton-tunnel
```

---

## Langkah 4 — Update .env di VPS 2

```bash
nano /var/www/canquest/apps/api/.env
```

Update nilai berikut sesuai node baru:
```env
CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_VALIDATOR_URL=http://127.0.0.1:8080
CANTON_VALIDATOR_PARTY_ID=PARTY_ID_NODE_BARU
CANTON_VALIDATOR_ADMIN_USER=administrator
CANTON_SPLICE_SECRET=SECRET_NODE_BARU
CANTON_SPLICE_AUDIENCE=AUDIENCE_NODE_BARU
```

Cara cari PARTY_ID node baru:
```bash
# Di VPS Node Baru:
docker exec splice-validator-participant-1 \
  curl -s http://localhost:7575/v1/parties | grep -i party
```

Cara cari SPLICE_SECRET:
```bash
# Di VPS Node Baru:
docker exec splice-validator-validator-1 env | grep -iE "secret|unsafe"
# atau:
cat /path/to/canton.conf | grep -i secret
```

Restart API setelah update .env:
```bash
pm2 restart canquest-api --update-env
```

---

## Langkah 5 — Verifikasi

```bash
# Test Canton JSON API (port 7575)
curl http://127.0.0.1:7575/livez

# Test Splice nginx (port 8080)
curl http://127.0.0.1:8080/api/validator/v0/version

# Test API health
curl https://api.canquest.cc/api/health

# Cek PM2
pm2 status
pm2 logs canquest-api --lines 20
```

---

## Checklist Pindah Node

| Step | Deskripsi | Status |
|------|-----------|--------|
| 1 | Cek IP Docker container di node baru | ⬜ |
| 2 | Tambah SSH key VPS 2 ke node baru | ⬜ |
| 3 | Test SSH tanpa password | ⬜ |
| 4 | Update canton-tunnel.service dengan IP baru | ⬜ |
| 5 | systemctl restart canton-tunnel | ⬜ |
| 6 | curl 7575/livez → response OK | ⬜ |
| 7 | Update .env CANTON_VALIDATOR_PARTY_ID | ⬜ |
| 8 | Update .env CANTON_SPLICE_SECRET | ⬜ |
| 9 | pm2 restart canquest-api --update-env | ⬜ |
| 10 | Test create wallet di app.canquest.cc | ⬜ |

---

## Nilai Saat Ini (Confirmed dari VPS 1)

| Variable | Value |
|----------|-------|
| VPS 1 IP | `162.250.191.46` |
| Participant container | `172.19.0.5` (port 7575) |
| Validator container | `172.19.0.6` (port 5003) |
| Nginx container | `172.19.0.7` (port 80) |
| ANS Web UI | `172.19.0.3` (port 8080) |
| Wallet Web UI | `172.19.0.2` (port 8080) |
| Postgres Splice | `172.19.0.4` (port 5432) |
| **Tunnel 1** | `VPS2:7575 → 172.19.0.5:7575` (Ledger API langsung) |
| **Tunnel 2** | `VPS2:8080 → 127.0.0.1:80` (Nginx VPS1) |
| **Host header** | `wallet.localhost` (untuk akses Splice API lewat nginx) |
| CANTON_JSON_API_URL | `http://127.0.0.1:7575` |
| CANTON_VALIDATOR_URL | `http://127.0.0.1:8080` |
| CANTON_VALIDATOR_HOST_HEADER | `wallet.localhost` |
| CANTON_SPLICE_SECRET | `unsafe` |
| CANTON_SPLICE_AUDIENCE | `https://validator.example.com` |
| CANTON_LEDGER_API_AUDIENCE | `https://ledger_api.example.com` |
| CANTON_LEDGER_API_USER | `ledger-api-user` |
| CANTON_VALIDATOR_ADMIN_USER | `ledger-api-user` |

Update tabel ini setiap ganti node agar mudah diingat.
