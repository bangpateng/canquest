# Runbook — DAML v24 Deploy (Multi-Controller Settle)

> **Tujuan:** Deploy DAML v24 (Settle multi-controller) untuk fix
> `DAML_AUTHORIZATION_ERROR`. v23 tidak bisa dipakai lagi untuk Settle
> karena nested TransferFactory_Transfer gagal auth.
>
> **Tanggal:** 2026-08-06
> **DAML:** v23 → v24 (fresh package, fresh DAR)
> **Effek:** Quest BARU create receipt v24 (bisa Settle). Contract v23
> lama tetap v23 (tidak bisa Settle v24, biarkan archived natural).

---

## TL;DR — 4 langkah

```bash
# 1. VPS 2: pull + build DAR (pakai docker daml-sdk)
cd /var/www/canquest && git pull origin master
docker run --rm -v "$(pwd)/packages/daml:/project" -w /project \
  digitalasset/daml-sdk:3.3.0-snapshot.20250930.0 \
  bash -lc "/home/daml/.daml/bin/daml build"

# 2. Upload DAR ke participant (VPS 1, via backend script)
cd apps/api && node scripts/upload-daml-dar.cjs

# 3. Update backend (build + restart)
npm run build && pm2 restart canquest-api --update-env

# 4. Test claim → cari Settle OK
```

---

## §1. Prasyarat

- [ ] DAR Splice dependencies sudah di `packages/daml/dars/`
      (`splice-api-token-*`, `splice-api-featured-app-*`).
      Kalau belum: `bash scripts/fetch-daml-deps.sh`
- [ ] Docker terinstall (untuk `daml build` tanpa install SDK lokal)
- [ ] Keycloak token bisa di-mint (untuk DAR upload)

---

## §2. Build DAR v24

```bash
cd /var/www/canquest
git pull origin master

# Verifikasi DAML v24
head -3 packages/daml/daml/Main.daml
# harus: "CanQuest DAML Contract v24" + "canquest-v24"

# Build (docker daml-sdk, image yg sama dgn apps/api package.json daml:build)
docker run --rm -v "$(pwd)/packages/daml:/project" -w /project \
  digitalasset/daml-sdk:3.3.0-snapshot.20250930.0 \
  bash -lc "/home/daml/.daml/bin/daml build"

# Verifikasi DAR terbuat
ls -la packages/daml/.daml/dist/canquest-v24-*.dar
```

**Kalau build gagal** (`Missing dependency` dll):
- Cek `packages/daml/dars/` punya 4 DAR Splice
- Cek `daml.yaml` data-dependencies path match file actual

---

## §3. Upload DAR ke Participant

DAR upload via backend script (`upload-daml-dar.cjs`). Ini butuh Keycloak token.

```bash
cd /var/www/canquest/apps/api

# Set env utk upload script (kalau belum)
export DAR_PATH="../packages/daml/.daml/dist/canquest-v24-1.2.0.dar"

# Upload
node scripts/upload-daml-dar.cjs
```

**Expected output:**
```
DAR uploaded successfully
packageId: <hash>
```

**Catat packageId** — tidak wajib di-set manual (backend auto-resolve via
`#canquest-v24` prefix), tapi berguna utk verifikasi.

### Alternatif: upload manual via curl

Kalau `upload-daml-dar.cjs` bermasalah, ikuti pattern `WALLET_USER_PROXY_SETUP.md`:

```bash
PARTICIPANT="http://172.18.0.6:7575"
KEYCLOAK_URL="https://auth.canquestlabs.com"
YOUR_SECRET="<LEDGER_CLIENT_SECRET>"
DAR_PATH="/var/www/canquest/packages/daml/.daml/dist/canquest-v24-1.2.0.dar"

ADMIN_TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/canton/protocol/openid-connect/token" \
  -d "client_id=validator-app-backend" -d "client_secret=$YOUR_SECRET" \
  -d "grant_type=client_credentials" -d "scope=daml_ledger_api" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -i -X POST "$PARTICIPANT/v2/dars" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$DAR_PATH"
# Expected: HTTP/1.1 200 OK, body {}
```

---

## §4. Update Backend

```bash
cd /var/www/canquest/apps/api

# Set CANTON_DAML_PACKAGE_NAME (kalau pakai explicit, bukan default)
# Edit .env: CANTON_DAML_PACKAGE_NAME=#canquest-v24
# Atau biarkan kosong → backend default ke #canquest-v24 (sudah di-code)

npm run build
pm2 restart canquest-api --update-env
```

**Verifikasi backend load v24:**
```bash
pm2 logs canquest-api --lines 30 --nostream | grep -iE "v24|package|template"
```

---

## §5. Test Settle v24

### Test 1 — Buat quest BARU

**PENTING:** Quest harus dibuat SETELAH v24 live. Quest lama (v23 contract)
tidak bisa Settle v24.

Buat quest CC FCFS baru (reward > 0, fee > 0) via admin panel.

### Test 2 — Claim + cek Settle

Claim sebagai user, lalu:
```bash
pm2 logs canquest-api --lines 100 --nostream | grep -iE \
  "DAML_SETTLE_FAIL|Settle OK|AUTH_DEBUG.*Settle|DAML_AUTHORIZATION"
```

### Verdict

**✅ BERHASIL (atomic jalan):**
```
AUTH_DEBUG submit: choice=Settle userId=... actAs=operator,karel,reward-user
Settle OK: settled=... updateId=... reward=true
```
- `Settle OK` muncul
- TIDAK ada `DAML_AUTHORIZATION_ERROR`
- TIDAK ada `collectClaimFee` (path fallback)
- Fee + reward = 1 updateId (atomic)

**❌ MASIH GAGAL:**
- Kalau `DAML_AUTHORIZATION_ERROR` lagi → controller party belum complete,
  paste log + AUTH_DEBUG
- Kalau error baru → paste log

---

## §6. Cleanup

### Contract v23 lama

Contract QuestClaimReceipt v23 yang masih `PRE_SETTLE` tidak bisa di-Settle
dengan v24 (template ID beda). Opsi:
- **Biarkan:** Expire natural (backend scheduler jalan Expire choice v23)
- **Manual archive:** kalau ada user complain, jalan Expire v23 manual

### AUTH_DEBUG log

Setelah stabil, AUTH_DEBUG log bisa di-remove (commit `1c2305f`). Tapi
biarkan dulu sampai beberapa hari observasi production.

---

## §7. Troubleshooting

### Build gagal: `Could not find module Splice.Api.FeaturedAppRightV2`
- DAR `splice-api-featured-app-v2` belum di `dars/`
- Fix: `bash scripts/fetch-daml-deps.sh`

### Upload gagal: `DAR already exists`
- DAR v24 belum ada di participant (ini normal utk first upload)
- Kalau muncul, berarti upload duplikat → hapus DAR lama atau skip

### Settle gagal: `template not found Main:QuestClaimReceipt`
- Backend masih pakai v23 prefix
- Fix: restart API (`pm2 restart canquest-api --update-env`)

### Settle gagal: `DAML_AUTHORIZATION_ERROR` lagi
- Co-controller belum cukup. Cek AUTH_DEBUG: actAs harus include semua
  controller (operator + user + rewardSender). Kalau ada party ke-4
  (appProvider utk FAR), tambah jadi controller saat FAR on.

---

## Checklist Eksekusi

- [ ] §1 Prasyarat: DAR Splice dependencies ada di dars/
- [ ] §2 Build DAR v24 (verifikasi `.daml/dist/canquest-v24-*.dar`)
- [ ] §3 Upload DAR ke participant (catat packageId)
- [ ] §4 Update backend (build + restart)
- [ ] §5 Test: buat quest BARU + claim → `Settle OK`
- [ ] §6 Cleanup: biarkan v23 contract Expire natural
