# CanQuest Mainnet Deployment Guide
## Package: canquest-v10 | SDK: 3.4.11 | Date: 2026-06-09

---

## Prasyarat

| Komponen | Status | Detail |
|---|---|---|
| Mainnet Validator Node | ✅ | VPS1, IP berbeda dari TestNet |
| Party Validator | ✅ | `canquest-validator-1::12209fe...5422fb` |
| VPS Website (VPS2) | ✅ | Sama dengan TestNet |
| DAR Package | ✅ | `canquest-v10-1.0.0.dar` |

---

## Step 1: Buat Party ID Tambahan di Mainnet

Di **VPS1 Mainnet**, jalankan via Splice Admin API:

### 1a. Operator Party (DAML Signatory)
```bash
curl -s -X POST http://127.0.0.1:8080/api/validator/v0/admin/users \
  -H "Content-Type: application/json" \
  -H "Host: wallet.localhost" \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -d '{"name":"canquest-operator"}'
# Simpan output party_id
```

### 1b. Fee/Treasury Party
```bash
curl -s -X POST http://127.0.0.1:8080/api/validator/v0/admin/users \
  -H "Content-Type: application/json" \
  -H "Host: wallet.localhost" \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -d '{"name":"canquest-fee"}'
# Simpan output party_id
```

---

## Step 2: Upload DAR ke Mainnet

Dari **VPS2**, pastikan SSH tunnel ke Mainnet participant aktif:

```bash
# Di VPS2, buka tunnel ke VPS1 Mainnet:
ssh -N -L 7575:<MAINNET_PARTICIPANT_IP>:7575 -L 8080:<MAINNET_NGINX_IP>:80 root@<VPS1_MAINNET_IP>

# Upload DAR (terminal lain di VPS2):
cd /var/www/canquest/apps/api
node scripts/upload-daml-dar.cjs /var/www/canquest/packages/daml/.daml/dist/canquest-v10-1.0.0.dar
```

Output: `CANTON_DAML_PACKAGE_ID=<64-char-hex>`

---

## Step 3: Konfigurasi `.env` Mainnet

Di **VPS2**, buat file `.env.mainnet`:

```env
# ── App + Web ──
NODE_ENV=production
PORT=3001
WEB_ORIGIN=https://canquest.cc,https://app.canquest.cc

# ── Database ──
DATABASE_URL=postgresql://...

# ── Canton Mainnet ──
CANTON_JSON_API_URL=http://127.0.0.1:7575
CANTON_SPLICE_SECRET=<MAINNET_SECRET>
CANTON_LEDGER_API_AUDIENCE=https://canton.network.global
CANTON_LEDGER_API_USER=ledger-api-user

CANTON_VALIDATOR_URL=http://127.0.0.1:8080
CANTON_VALIDATOR_HOST_HEADER=wallet.localhost
CANTON_SPLICE_AUDIENCE=https://validator.example.com
CANTON_VALIDATOR_ADMIN_USER=administrator

# ── Party IDs (3 PARTY BERBEDA) ──
CANTON_VALIDATOR_PARTY_ID=canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
CANTON_OPERATOR_PARTY_ID=canquest-operator::<OPERATOR_FINGERPRINT>
CANTON_FEE_RECIPIENT_PARTY_ID=canquest-fee::<FEE_FINGERPRINT>
CANTON_FEE_ACCEPT_USERNAME=canquest-fee
CANTON_APP_PROVIDER_PARTY_ID=canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb

# ── DAML ──
CANTON_DAML_PACKAGE_NAME=canquest-v10
CANTON_DAML_PACKAGE_ID=<DARI_STEP_2>
QUEST_LEDGER_ENABLED=true
CLAIM_SESSION_LEDGER_ENABLED=true
```

---

## Step 4: Deploy + Test

```bash
# Di VPS2
cd /var/www/canquest/apps/api

# Ganti .env dengan .env.mainnet
cp .env .env.testnet.bak
cp .env.mainnet .env

# Build & restart
npm run build
pm2 restart canquest-api

# Test
# 1. Register wallet user baru
# 2. Claim quest FCFS
# 3. Check log: pm2 logs canquest-api --lines 20
```

---

## Arsitektur Party Mainnet

```
┌─────────────────────────────────────────────────┐
│  3 PARTY — FINGERPRINT BERBEDA                  │
│                                                 │
│  1. canquest-validator-1::12209fe...5422fb      │
│     └─ Kirim CC reward, terima spin cost        │
│                                                 │
│  2. canquest-operator::<OP_FINGERPRINT>          │
│     └─ DAML signatory semua kontrak              │
│                                                 │
│  3. canquest-fee::<FEE_FINGERPRINT>              │
│     └─ Terima claim fee quest                    │
└─────────────────────────────────────────────────┘