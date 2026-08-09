# Runbook — DAML v28 Deploy (Settle Rollback + Wallet 2-step)

> **Tujuan:** Deploy DAML v28 (6 template: +WalletRegistrationProposal,
> WalletRegistration userProfileRef, CampaignEligibility non-consuming,
> kembali QuestClaimReceipt + Settle multi-controller).
>
> **Tanggal:** 2026-08-10
> **Branch:** `feat/daml-v28-settle-rollback` → merge ke master
> **DAML:** v25/v27 → v28 (fresh package `canquest-v28` v1.0.0)
> **Backend:** sudah adapted (commit `45df80e`) — WalletRegistration 2-step

---

## TL;DR — 5 langkah

```bash
# 1. Pull + build DAR v28
cd /var/www/canquest && git pull origin master
cd packages/daml && daml build
ls .daml/dist/canquest-v28-*.dar   # verifikasi

# 2. Upload DAR v28 ke participant
cd /var/www/canquest/apps/api
node scripts/upload-daml-dar.cjs   # auto-detect DAR v28

# 3. Update .env: CANTON_DAML_PACKAGE_NAME
nano .env   # ganti CANTON_DAML_PACKAGE_NAME=canquest-v28

# 4. Build + restart backend
npm run build && pm2 restart canquest-api --update-env

# 5. Test wallet register (§4) — verifikasi 2-step Proposal→Accept
```

---

## §1. Build DAR v28

```bash
cd /var/www/canquest
git pull origin master
git log --oneline -1   # HEAD terbaru (v28 commits)

cd packages/daml
head -1 daml.yaml   # harus: sdk-version: 3.4.11
grep "name:\|version:" daml.yaml
# harus: name: canquest-v28, version: 1.0.0

# Pastikan 4 DAR data-dep ada
ls dars/*.dar | wc -l   # harus >= 4 (atau 6 dgn file lama)

# Kalau < 4: fetch dulu
bash scripts/fetch-daml-deps.sh

# Build
daml build
ls -la .daml/dist/canquest-v28-*.dar
# harus ada: canquest-v28-1.0.0.dar (~700KB)
```

**Kalau build gagal** (`Missing dependency`):
- Cek `packages/daml/dars/` punya 4 DAR Splice API:
  - `splice-api-token-transfer-instruction-v1-1.0.0.dar`
  - `splice-api-token-holding-v1-current.dar`
  - `splice-api-token-metadata-v1-1.0.0.dar`
  - `splice-api-featured-app-v2-1.0.0.dar`
- Kalau belum: `bash scripts/fetch-daml-deps.sh`

**Kalau build gagal** (syntax error di `Main.daml`):
- Cek versi SDK: `daml version` (harus 3.4.11)
- Cek `import` block (3 import: TransferInstructionV1, MetadataV1, FeaturedAppRightV2)

---

## §2. Upload DAR v28 ke Participant

```bash
cd /var/www/canquest/apps/api

# Pastikan .env punya LEDGER config
grep -E "LEDGER_API_URL|CANTON_JSON_API_URL|LEDGER_AUTH_MODE" .env

# Upload (auto-detect DAR v28 di packages/daml/.daml/dist/)
node scripts/upload-daml-dar.cjs

# Output harus: package registered, package ID ditampilkan
# Simpan package ID utk verify (§3)
```

**Alternatif curl manual** (kalau script bermasalah):
```bash
# Ambil token Keycloak
TOKEN=$(curl -s -X POST "http://keycloak.localhost:8082/realms/AppProvider/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=app-provider" \
  -d "client_secret=$LEDGER_CLIENT_SECRET" \
  | jq -r .access_token)

# Upload DAR
curl -X POST "https://ledger.canquestlabs.com/v2/dars?vetAllPackages=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary @../packages/daml/.daml/dist/canquest-v28-1.0.0.dar

# Inspect package ID
damlc inspect-dar --json ../packages/daml/.daml/dist/canquest-v28-1.0.0.dar | jq '.main_package_id'
```

---

## §3. Update .env + restart backend

```bash
cd /var/www/canquest/apps/api

# Edit .env
nano .env
# Ganti:
#   CANTON_DAML_PACKAGE_NAME=canquest-v25   (atau v23)
#   → CANTON_DAML_PACKAGE_NAME=canquest-v28

# Optional: set package ID eksplisit (lebih cepat resolve)
# CANTON_DAML_PACKAGE_ID=<package-id-dari-§2>

# Build + restart
npm run build
pm2 restart canquest-api --update-env

# Verifikasi backend up
pm2 status
pm2 logs canquest-api --lines 20 --nostream
```

---

## §4. Test Matrix

### Test 1: Wallet Registration (2-step Proposal→Accept) — PALING PENTING

Ini test perubahan utama v28. Wallet register harus create Proposal →
exercise Accept → create WalletRegistration co-signed.

```bash
# Register wallet baru via API (register endpoint atau wallet onboarding)
# Lalu check ledger utk 2 contract:
#   - WalletRegistrationProposal (archived setelah Accept)
#   - WalletRegistration (created, co-signed admin + userAddress)

curl -s "https://ledger.canquestlabs.com/v2/contracts?templateId=$(grep PACKAGE_NAME .env | cut -d= -f2):Main:WalletRegistration" \
  -H "Authorization: Bearer $TOKEN" | jq '.result | length'
# harus: >= 1

# Cek field userProfileRef (BUKAN username/inviteCode)
curl -s "https://ledger.canquestlabs.com/v2/contracts?templateId=$(grep PACKAGE_NAME .env | cut -d= -f2):Main:WalletRegistration" \
  -H "Authorization: Bearer $TOKEN" | jq '.result[0].payload | keys'
# harus ada: "userProfileRef" (format "user:<uuid>")
# TIDAK boleh ada: "username", "inviteCode"
```

**Kalau gagal** (`Failed to create WalletRegistrationProposal`):
- Cek actAs rights: backend harus grant rights utk user party sebelum Accept
- Lihat log: `pm2 logs canquest-api | grep -i "wallet\|proposal\|accept"`
- Cek party ID user valid di validator

### Test 2: Quest Campaign create + ClaimSlot (tidak berubah dari v25)
```bash
# Via admin panel: create campaign → activate → user claim FCFS
# Backend log harus: "ClaimSlot OK" (tuple extraction tetap jalan)
# Lihat RUNBOOK_DAML_V25_DEPLOY.md §4 utk detail
```

### Test 3: Settle atomic (tidak berubah dari v25)
```bash
# Settle multi-controller [admin, userAddress, rewardSender]
# Backend log harus: "Settle OK"
```

### Test 4: PlatformTransfer send token (tidak berubah dari v25)
```bash
# Send CC / USDCx via wallet
# Backend log harus: "ExecuteTransfer OK"
```

---

## §5. Rollback (kalau v28 bermasalah)

DAML v28 = **fresh package** (`canquest-v28`). Package lama (`canquest-v25`)
masih registered di participant. Rollback = revert env + code:

```bash
cd /var/www/canquest

# Revert code ke commit sebelum v28
git log --oneline -10   # cari commit terakhir sebelum v28
git reset --hard <commit-sebelum-v28>

# Revert .env
nano apps/api/.env
#   CANTON_DAML_PACKAGE_NAME=canquest-v25   (kembali ke lama)

# Build + restart
cd apps/api && npm run build
pm2 restart canquest-api --update-env

# DAR v25 TIDAK perlu re-upload (masih registered)
# Contract lama (QuestClaimReceipt v25 dst) tetap aktif
```

**Yang TIDAK bisa rollback**:
- Contract v28 yang sudah created di ledger tetap ada (WalletRegistration v28
  co-signed, Proposal archived, dst). Tidak mengganggu v25 — package berbeda.

---

## §6. Perubahan v28 vs v25 (ringkasan utk troubleshooting)

| Komponen | v25 (lama) | v28 (baru) | Backend impact |
|---|---|---|---|
| WalletRegistration | signatory admin; fields username/inviteCode | signatory admin,userAddress; field userProfileRef | registerWallet() rewrite 2-step |
| WalletRegistrationProposal | — | NEW template (admin propose → user Accept) | NEW flow di registerWallet() |
| CampaignEligibility revoke/expire | consuming (archive) | non-consuming (create baru REVOKED/EXPIRED) | dormant (belum ada caller) |
| QuestCampaign ClaimSlot/DrawWinner | return ContractId | return tuple (Campaign, Receipt) | tidak berubah (sudah tuple extraction) |
| QuestClaimReceipt + Settle | ada | ada (kembali dari v27 deletion) | tidak berubah |
| QuestPaymentRequest (v27) | — | HAPUS (rollback ke Settle) | tidak ada di backend |

---

## §7. Troubleshooting

### "WalletRegistrationProposal create OK tapi Accept gagal"
- Cause: backend belum grant rights utk `userAddress` party
- Fix: cek `grantUserRights(params.userPartyId)` di registerWallet() jalan
- Log: `grantUserRights(user) failed` → service account butuh CanActAs utk user party

### "userProfileRef kosong / undefined"
- Cause: caller `recordPartyRegistration` tidak pass `userId`
- Fix: pastikan `req.user.userId` / `userId` param ada di kedua caller party.controller.ts

### "Build DAR gagal: cannot find module Splice.Api..."
- Cause: 4 DAR data-dep tidak ada
- Fix: `bash scripts/fetch-daml-deps.sh` (lihat §1)

### "Package not registered" setelah upload
- Cause: vetting belum selesai / participant belum sync
- Fix: tunggu 30s, lalu retry verify:
  ```bash
  curl -s "https://ledger.canquestlabs.com/v2/packages/<package_id>/status" \
    -H "Authorization: Bearer $TOKEN"
  # harus: "PACKAGE_STATUS_REGISTERED"
  ```
