# CanQuest — Guide Migrasi ke Canton Mainnet

> **Arsitektur Target:**
> - **VPS 1 (IP Baru)** — Canton Validator Node Full (participant + splice + ledger API)
> - **VPS 2 (IP Lama)** — Database (PostgreSQL), API (NestJS), Tunnel ke VPS 1

---

## Gambaran Arsitektur

```
Internet
    │
    ▼
[Vercel] ← Next.js Web (canquest.cc)
    │  HTTPS
    ▼
[VPS 2 - IP Lama] ─── WireGuard Tunnel ──► [VPS 1 - IP Baru]
  - NestJS API (port 3001)                   - Canton Participant
  - PostgreSQL (port 5432)                   - Splice Validator
  - Redis (port 6379)                        - JSON Ledger API (:7575)
  - Nginx reverse proxy                      - Validator API (:8080)
  - PM2 process manager                      - Canton Console
```

---

## BAGIAN 1 — VPS 1 (IP Baru): Setup Canton Mainnet Validator

### 1.1 Spesifikasi VPS 1 yang Direkomendasikan
- **CPU**: 8 core minimum
- **RAM**: 16 GB minimum (32 GB ideal)
- **Disk**: 500 GB SSD (ledger data tumbuh terus)
- **OS**: Ubuntu 22.04 LTS
- **Port yang perlu dibuka**: 
  - `5041` (Canton P2P — untuk sync dengan network)
  - Semua port lain **TUTUP** dari internet, hanya buka ke VPS 2 via WireGuard

### 1.2 Daftar ke Canton Mainnet
1. Kunjungi: https://canton.network/validator-onboarding
2. Daftar sebagai validator operator
3. Dapatkan **onboarding secret** (mirip `CANTON_SPLICE_SECRET` di testnet)
4. Ikuti proses KYC/approval dari Canton Network team

### 1.3 Install Canton Validator di VPS 1
```bash
# Download Canton release terbaru (sesuaikan versi)
wget https://github.com/digital-asset/canton/releases/download/v3.x.x/canton-open-source-3.x.x.tar.gz
tar -xzf canton-open-source-3.x.x.tar.gz

# Atau gunakan Docker (lebih mudah)
docker pull digitalasset/canton-network-validator:latest
```

### 1.4 Konfigurasi Canton Validator (VPS 1)
Buat file `/etc/canton/validator.conf`:
```hocon
canton {
  validator-apps {
    validator {
      storage.type = postgres
      storage.config {
        dataSourceClass = "org.postgresql.ds.PGSimpleDataSource"
        properties.serverName = "localhost"
        properties.portNumber = 5432
        properties.databaseName = "canton_validator"
        properties.user = "canton"
        properties.password = "GANTI_PASSWORD_KUAT"
      }
      
      # Mainnet endpoint
      ledger-api-user = "ledger-api-user"
      
      # Onboarding secret dari Canton Network
      onboarding.secret = "ONBOARDING_SECRET_DARI_CANTON_NETWORK"
      
      # Party hint untuk operator kamu
      party-hint = "canquest-operator"
      
      # JSON API port (diakses dari VPS 2 via tunnel)
      json-api-port = 7575
      
      # Validator API port
      validator-api-port = 8080
    }
  }
}
```

### 1.5 Setup WireGuard di VPS 1
```bash
apt install wireguard -y

# Generate key
wg genkey | tee /etc/wireguard/vps1_private.key | wg pubkey > /etc/wireguard/vps1_public.key

# Buat config /etc/wireguard/wg0.conf
cat > /etc/wireguard/wg0.conf << EOF
[Interface]
PrivateKey = $(cat /etc/wireguard/vps1_private.key)
Address = 10.10.0.1/24
ListenPort = 51820

[Peer]
# VPS 2
PublicKey = VPS2_PUBLIC_KEY_DISINI
AllowedIPs = 10.10.0.2/32
EOF

systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0
```

---

## BAGIAN 2 — VPS 2 (IP Lama): Update Konfigurasi

### 2.1 Update WireGuard di VPS 2
```bash
# Update /etc/wireguard/wg0.conf — ganti peer ke VPS 1 baru
[Interface]
PrivateKey = VPS2_PRIVATE_KEY
Address = 10.10.0.2/24

[Peer]
# VPS 1 Mainnet (IP Baru)
PublicKey = VPS1_PUBLIC_KEY
Endpoint = IP_BARU_VPS1:51820
AllowedIPs = 10.10.0.1/32
PersistentKeepalive = 25
```

### 2.1.1 Cara Mendapatkan Party IDs Baru (Setelah VPS 1 Join Mainnet)

Setelah Canton validator VPS 1 sudah jalan dan join mainnet, jalankan ini dari VPS 2:

```bash
# Cek status validator dan dapatkan party ID
curl http://10.10.0.1:8080/api/validator/v0/status | python3 -m json.tool

# Output akan ada field seperti:
# "validatorPartyId": "canquest-validator::1220XXXX..."
```

Atau via Canton console di VPS 1:
```bash
# Di VPS 1
canton console
# Ketik:
participant1.parties.list()
```

Catat semua party ID yang muncul — itu yang dimasukkan ke `.env`.

---

### 2.2 Update `.env` di VPS 2
File: `/var/www/canquest/apps/api/.env`

```bash
# ============================================================
# CANTON MAINNET — ganti semua nilai ini
# ============================================================

# 6a — Ledger API (via WireGuard tunnel ke VPS 1)
CANTON_JSON_API_URL=http://10.10.0.1:7575

# 6b — Splice / Validator API (via WireGuard tunnel ke VPS 1)
CANTON_VALIDATOR_URL=http://10.10.0.1:8080

# 6c — Party IDs BARU dari mainnet
# Dapatkan setelah VPS 1 join mainnet dan party terdaftar
CANTON_VALIDATOR_PARTY_ID=canquest-validator::HASH_MAINNET_BARU
CANTON_APP_PROVIDER_PARTY_ID=canquest-validator::HASH_MAINNET_BARU
CANTON_FEE_RECIPIENT_PARTY_ID=canquest-validator::HASH_MAINNET_BARU
CANTON_OPERATOR_PARTY_ID=canquest-operator::HASH_MAINNET_BARU

# 6d — DAML package (PERLU UPLOAD ULANG ke mainnet — lihat Bagian 3)
CANTON_DAML_PACKAGE_NAME=canquest-v6
CANTON_DAML_PACKAGE_ID=HASH_BARU_SETELAH_UPLOAD_KE_MAINNET

# Onboarding secret mainnet
CANTON_SPLICE_SECRET=SECRET_MAINNET_DARI_CANTON_NETWORK

# Audience mainnet (tanya Canton Network team untuk nilai yang benar)
CANTON_LEDGER_API_AUDIENCE=https://canton.network.global

# ============================================================
# SECURITY — WAJIB GANTI SEMUA INI
# ============================================================
JWT_ACCESS_SECRET=GENERATE_BARU_MIN_64_CHAR_RANDOM
ADMIN_PANEL_PASSWORD=PASSWORD_KUAT_BARU
```

**Generate JWT secret baru:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## BAGIAN 3 — DAML Contract: Perlu Deploy Ulang?

### Jawaban: **YA, PERLU UPLOAD ULANG ke mainnet**

Alasannya:
- DAR yang ada sekarang ter-deploy di **testnet participant**
- Mainnet adalah ledger yang **berbeda sama sekali** — tidak ada data testnet di sana
- DAR harus di-upload ke mainnet participant (VPS 1 baru)

### 3.1 Upload DAR ke Mainnet
Setelah VPS 1 mainnet sudah jalan:

```bash
# Di VPS 2, jalankan upload script
# Pastikan .env sudah diupdate ke mainnet endpoint dulu
cd /var/www/canquest/apps/api
node scripts/upload-daml-dar.cjs
```

### 3.2 Verifikasi DAR di Mainnet
```bash
node scripts/verify-daml-package.cjs
```

Output yang diharapkan:
```
livez: 200 OK
Packages on participant: X
CANTON_DAML_PACKAGE_ID abc123... present
ACS probe OK for #canquest-v3:Main:UserAccount
ACS probe OK for #canquest-v3:Main:Mission
ACS probe OK for #canquest-v3:Main:DailyLuckySpin
```

### 3.3 Update CANTON_DAML_PACKAGE_ID
Setelah upload, catat package ID baru dan update `.env`:
```bash
CANTON_DAML_PACKAGE_ID=HASH_BARU_DARI_MAINNET
```

---

## BAGIAN 4 — Migrasi Data

### 4.1 Data yang TIDAK perlu dimigrasikan
- DAML contracts di testnet — **tidak perlu**, mainnet mulai fresh
- CC balance testnet — **tidak valid** di mainnet

### 4.2 Data yang PERLU dimigrasikan (opsional)
- User accounts (email, username, password hash) — bisa migrate kalau mau
- Quest/campaign data — bisa migrate

### 4.3 Backup & Restore PostgreSQL
```bash
# Di VPS 2 — backup DB testnet
pg_dump -U canquest canquest_app > /backup/canquest_testnet_$(date +%Y%m%d).sql

# Untuk mainnet, bisa mulai fresh atau restore:
# psql -U canquest canquest_app < /backup/canquest_testnet_YYYYMMDD.sql
```

---

## BAGIAN 5 — Checklist Sebelum Go-Live Mainnet

### Pre-launch (lakukan sebelum buka ke publik)
- [ ] VPS 1 sudah join Canton mainnet dan sync penuh
- [ ] WireGuard tunnel VPS 2 → VPS 1 aktif dan stabil
- [ ] DAR sudah ter-upload ke mainnet participant
- [ ] Semua party IDs sudah diupdate di `.env`
- [ ] JWT secret dan admin password sudah diganti
- [ ] `CANTON_DAML_PACKAGE_ID` sudah diupdate
- [ ] Test: buat 1 user, spin 1x, claim 1 quest — semua berhasil
- [ ] Backup DB otomatis aktif (cron job)
- [ ] Monitor PM2 logs tidak ada error

### Test Fungsional
```bash
# 1. Health check
curl http://localhost:3001/api/health

# 2. Verify DAML package
node scripts/verify-daml-package.cjs

# 3. Check PM2 logs
pm2 logs canquest-api --lines 50 --nostream
```

### Monitoring yang Direkomendasikan
```bash
# Cek tunnel aktif
wg show

# Cek koneksi ke VPS 1
curl http://10.10.0.1:7575/livez

# Cek Canton validator status
curl http://10.10.0.1:8080/api/validator/v0/status
```

---

## BAGIAN 6 — Estimasi Waktu & Biaya

| Item | Estimasi |
|------|----------|
| Setup VPS 1 + Canton install | 1-2 hari |
| Onboarding approval Canton Network | 3-7 hari (tergantung review) |
| Sync mainnet ledger (initial) | 4-12 jam |
| Upload DAR + konfigurasi | 1-2 jam |
| Testing end-to-end | 1 hari |
| **Total** | **~1-2 minggu** |

| Biaya | Estimasi |
|-------|----------|
| VPS 1 (8 core, 16GB, 500GB SSD) | $80-150/bulan |
| VPS 2 (existing) | Tetap sama |
| Canton mainnet onboarding fee | Tanya Canton Network team |

---

## BAGIAN 7 — Rollback Plan

Jika ada masalah saat mainnet:
1. Ganti `.env` kembali ke testnet values
2. Restart API: `pm2 restart canquest-api --update-env`
3. Testnet tetap jalan — tidak ada data yang hilang

---

---

## BAGIAN 8 — Perbedaan Testnet vs Mainnet (Ringkasan)

| Aspek | Testnet (Sekarang) | Mainnet (Nanti) |
|-------|-------------------|-----------------|
| CC value | Tidak ada nilai nyata | **Uang asli** |
| VPS Canton | VPS 2 (shared) | VPS 1 dedicated |
| Party IDs | `naxweb-validator-1::...` | `canquest-validator::...` (baru) |
| DAR | Sudah ter-deploy | **Perlu upload ulang** |
| Data user | Test data | Fresh start (atau migrate) |
| Onboarding | Otomatis | Perlu approval Canton Network |
| `.env` | Testnet values | **Semua diganti** |
| Kode API | ✅ Tidak perlu diubah | ✅ Tidak perlu diubah |

---

## Referensi
- Canton Network Docs: https://docs.canton.network
- Validator Onboarding: https://canton.network/validator-onboarding
- Canton SDK: https://github.com/digital-asset/canton
- Canton Mainnet Explorer: https://scan.canton.network
