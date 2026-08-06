# Runbook — DAML v25 Deploy (Eligibility + PlatformTransfer)

> **Tujuan:** Deploy DAML v25 (5 template: +CampaignEligibility, +PlatformTransfer,
> QuestCampaign +eligibility, RecordTxId Optional). v24 contract lama tetap
> (dual-version DAML, tidak dihapus).
>
> **Tanggal:** 2026-08-06
> **HEAD:** `189964b` (Fase 3)
> **DAML:** v24 → v25 (fresh package `canquest-v25` v1.3.0)

---

## TL;DR — 5 langkah

```bash
# 1. Pull + build DAR v25 (native SDK, sama v24)
cd /var/www/canquest && git pull origin master
cd packages/daml && daml build
ls .daml/dist/canquest-v25-*.dar   # verifikasi

# 2. Upload DAR v25 ke participant (curl manual, BUKAN script lama)
#    (lihat §2 — pakai https://ledger.canquestlabs.com, BUKAN 172.18.0.6)

# 3. DB migration (prisma)
cd /var/www/canquest/apps/api
npx prisma migrate deploy   # atau db push

# 4. Build + restart backend
npm run build && pm2 restart canquest-api --update-env

# 5. Test (§4 test matrix — 10 case)
```

---

## §1. Build DAR v25

```bash
cd /var/www/canquest
git pull origin master
git log --oneline -1   # harus: 189964b feat(api): v25 Fase 3

cd packages/daml
head -1 daml.yaml   # harus: sdk-version: 3.4.11
grep "name:\|version:" daml.yaml
# harus: name: canquest-v25, version: 1.3.0

daml build
ls -la .daml/dist/canquest-v25-*.dar
# harus ada: canquest-v25-1.3.0.dar (~700KB)
```

**Kalau build gagal** (`Missing dependency`):
- Cek `packages/daml/dars/` punya 4 DAR Splice
- Kalau belum: `bash scripts/fetch-daml-deps.sh`

---

## §2. Upload DAR v25 ke Participant

⚠️ **PENTING:** Pakai URL **public** `https://ledger.canquestlabs.com`, BUKAN `172.18.0.6`
(Docker internal IP hanya reachable dari VPS 1). Ini yang terbukti jalan di v24 deploy.

```bash
# Jalankan di VPS 2 (di mana DAR di-build)
PARTICIPANT="https://ledger.canquestlabs.com"
KEYCLOAK_URL="https://auth.canquestlabs.com"
YOUR_SECRET="<LEDGER_CLIENT_SECRET dari .env>"
DAR_PATH="/var/www/canquest/packages/daml/.daml/dist/canquest-v25-1.3.0.dar"

# Ambil token
ADMIN_TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/canton/protocol/openid-connect/token" \
  -d "client_id=validator-app-backend" -d "client_secret=$YOUR_SECRET" \
  -d "grant_type=client_credentials" -d "scope=daml_ledger_api" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "Token length: ${#ADMIN_TOKEN}"   # harus 1446

# Upload — TUNGGU sampai selesai (jangan Ctrl+C)
curl -i -X POST "$PARTICIPANT/v2/dars" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$DAR_PATH" \
  --max-time 120
# Expected: HTTP/2 200, body {}
```

---

## §3. DB Migration + Backend

### 3a. Migration

```bash
cd /var/www/canquest/apps/api

# Pakai DIRECT_URL (port 5432) utk migrate, BUKAN DATABASE_URL (pooler 6543)
npx prisma migrate deploy
# Expected: 1 migration applied (20260806120000_add_v25_eligibility_platform_transfer)

# Kalau migrate deploy bermasalah dgn DIRECT_URL, pakai db push:
# npx prisma db push
```

**Verifikasi tabel baru:**
```bash
# Cek via prisma
npx prisma studio   # buka browser, cek tabel: CampaignEligibilityLedger, PlatformTransferLedger
# Atau query:
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$queryRaw\`SELECT column_name FROM information_schema.columns WHERE table_name = 'CampaignEligibilityLedger'\`
  .then(r => { console.log('CampaignEligibilityLedger columns:', r.map(x => x.column_name).join(', ')); })
  .finally(() => p.\$disconnect());
"
```

### 3b. Update .env

```bash
nano .env
```

Cari `CANTON_DAML_PACKAGE_NAME` → ubah jadi:
```
CANTON_DAML_PACKAGE_NAME=canquest-v25
```
(Format: tanpa `#`, code auto-add. Sama seperti v24.)

### 3c. Build + restart

```bash
npm run build   # harus sukses (TypeScript clean setelah Fase 2-3)
pm2 restart canquest-api --update-env
```

**Verifikasi backend load v25:**
```bash
pm2 logs canquest-api --lines 30 --nostream | grep -iE "v25|template|package|error"
```

---

## §4. Test Matrix (10 case)

⚠️ **PENTING:** Buat **quest BARU** untuk tiap test. Quest lama (v24 contract) tidak
bisa pakai v25 (template ID beda).

### Test 1 — CC FCFS, NO eligibility (smoke test)
- Buat quest: rewardType CC_ONLY, entryGateMode NONE, reward 0.01 CC, fee 0.01 CC
- Claim sebagai user
- **Expected:** `Settle OK: settled=... updateId=... reward=true`
- **Verdict:** Settle v25 working (sama seperti v24)

### Test 2 — CC FCFS, LOCK_CC eligibility, lock SETELAH campaign
- Buat quest: entryGateMode CC_ONLY, entryCcLock 1
- User lock 1 CC **SETELAH** quest dibuat
- Claim
- **Expected:** `Settle OK`, eligibilityCid resolved, lock guard pass

### Test 3 — CC FCFS, LOCK_CC, lock KURANG
- Quest: entryCcLock 5
- User lock hanya 1 CC
- Claim
- **Expected:** `Lock CC kurang dari minimum (1 < 5 CC)` (BadRequestException)

### Test 4 — CC FCFS, LOCK_CC, lock LAMA (sebelum campaign)
- Quest: entryCcLock 1
- User lock 1 CC **SEBELUM** quest dibuat (lock lama)
- Claim
- **Expected:** `Lock CC harus dilakukan SETELAH campaign dibuat` (BadRequestException)

### Test 5 — CC FCFS, POINTS eligibility, points cukup
- Quest: entryGateMode POINTS_ONLY, entryCostPoints 10
- User punya points >= 10
- Claim
- **Expected:** `Settle OK`, eligibilityCid resolved (POINTS type)

### Test 6 — CC FCFS, POINTS, points KURANG
- Quest: entryCostPoints 9999
- User points < 9999
- Claim
- **Expected:** `Points kurang dari minimum` (BadRequestException)

### Test 7 — Raffle (CC_RAFFLE), NO eligibility
- Buat quest CC_RAFFLE, admin draw winner
- **Expected:** `Settle OK` (mirror Test 1 utk raffle)

### Test 8 — Kode claim (reward=0)
- Buat quest CODE_FCFS
- Claim
- **Expected:** `Settle OK reward=false`, RecordTxId rewardTxId=null

### Test 9 — USDCx reward
- Buat quest rewardToken USDCx, reward 0.01 USDCx
- Claim
- **Expected:** `Settle OK reward=true` (instrumentId=USDCx)
- ⚠️ Kalau gagal (holding format beda), paste log

### Test 10 — CC_OR_POINTS mode (backend-only, on-chain NONE)
- Quest: entryGateMode CC_OR_POINTS
- **Expected:** DAML eligibilityType=NONE (backend cek dua-duanya off-chain),
  on-chain tidak ada guard. Settle jalan tanpa eligibilityCid.

### Command cek semua test:
```bash
pm2 logs canquest-api --lines 100 --nostream | grep -iE \
  "DAML_SETTLE_FAIL|Settle OK|eligibility|Lock CC|Points kurang|BAD_REQUEST|BadRequestException"
```

---

## §5. Rollback (kalau parah)

Kalau v25 rusak parah, kembali ke v24:

```bash
cd /var/www/canquest/apps/api
# Set package name balik ke v24
sed -i 's/CANTON_DAML_PACKAGE_NAME=canquest-v25/CANTON_DAML_PACKAGE_NAME=canquest-v24/' .env
# Quest lama (v24 contract) tetap bisa di-Settle. Quest v25 baru tidak.
pm2 restart canquest-api --update-env
```

⚠️ Quest yang sudah dibuat dengan v25 (ledgerCampaignId v25) tidak bisa Settle v24.
Hanya quest v24 lama yang kembali aktif.

---

## §6. Catatan teknis

### Dual-version DAML
- DAR v24 tetap di participant (jangan hapus). Contract v24 lama butuh utk Settle/Expire v24.
- DAR v25 baru upload. Quest baru create receipt v25.
- Quest lama (v24) biarkan Expire natural.

### PlatformTransfer
- DAML template + backend method (createPlatformTransfer + executePlatformTransfer) ready.
- **TAPI wiring ke sendCc belum** (party.controller masih pakai 2 transfer terpisah).
- Feature flag `QUEST_ATOMIC_PLATFORM_TRANSFER` (default false) utk enable saat siap.
- Send token tetap jalan via path lama (non-atomic tapi fungsi).

### Auth/Rights
- `CanActAsAnyParty` tidak perlu (dari investigasi v24, rights per-party sudah cukup).
- Service-account punya CanActAs(karel) + CanActAs(reward-user) + CanActAs(operator) + CanActAs(fee).

---

## Checklist Eksekusi

- [ ] §1 Build DAR v25 (verifikasi `.daml/dist/canquest-v25-1.3.0.dar`)
- [ ] §2 Upload DAR v25 (HTTP/2 200 {})
- [ ] §3a DB migration applied
- [ ] §3b .env: CANTON_DAML_PACKAGE_NAME=canquest-v25
- [ ] §3c Build + restart backend
- [ ] §4 Test 1 (smoke) → Settle OK
- [ ] §4 Test 2-6 (eligibility) → sesuai expected
- [ ] §4 Test 7-10 (raffle/kode/USDCx/CC_OR_POINTS)
- [ ] §6 Catat: DAR v24 tetap (jangan hapus)
