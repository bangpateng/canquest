# Runbook — DAML v27 Deploy (AppPaymentRequest Architecture) — MAINNET

> **Tujuan:** Deploy DAML v27 backend rewrite (Fase 2) ke **MAINNET**.
> Reward flow 2 PATH: PlatformTransfer (PATH A, instan) + AppPaymentRequest
> (PATH B, sync Accept). v25 Settle tetap jalan sebagai fallback.
>
> **Tanggal:** 2026-08-09
> **Branch:** `feat/daml-v27-fase2-backend` (6 commit, merge ke master saat siap)
> **DAML:** v25 → v27 (fresh package `canquest-v27` v1.4.0, DAR sudah dibuild di VPS)
> **Environment:** ⚠️ **MAINNET** (bukan testnet)

---

## ⚠️ MAINNET-specific constraints

| Item | Catatan |
|---|---|
| **FeaturedAppRight (FAR)** | ❌ **Belum approved CF** (status saat deploy ini). FAR marker dibuat di ExecuteTransfer/Collect TAPI tidak generate CC app rewards (sia-sia). Transfer reward+fee tetap jalan aman tanpa FAR. |
| **DSO party ID** | Dari `https://scan.sv-1.global.canton.network.sync.global/v0/dso-party-id` (MainNet endpoint, BUKAN dev/test) |
| **FAR marker pelanggaran** | Pelanggaran fair usage policy → penalti Tokenomics Committee CF. Marker HANYA boleh di ExecuteTransfer & AcceptedAppPayment_Collect (sudah diimplementasi benar di code). |
| **Funding REWARD_SENDER** | Wajib pre-funded sebelum test. Saldo CC harus ≥ (rewardCc × maxWinners) + 10% buffer. Cek via `GET /v0/admin/amulet/balance/{REWARD_SENDER_PARTY}`. |

**Implikasi FAR off di routing:**
- PATH A: `actAs [operator, user, rewardSender]` (3-party, appProvider skip karena FAR off). ExecuteTransfer skip leg 3.
- PATH B: `createAppPaymentRequest` **tetap butuh appProvider di actAs 5-party** (provider = signatory AppPaymentRequest, terpisah dari FAR). Service account butuh CanActAs appProvider meski FAR off.

---

## TL;DR — 7 langkah

```bash
# 1. Merge branch + pull di VPS
cd /var/www/canquest && git pull origin master   # setelah merge feat/daml-v27-fase2-backend
git log --oneline -6   # verify 6 commit Fase 2

# 2. DB migration (nullable, zero-risk)
cd apps/api && npx prisma migrate deploy

# 3. Set env vars
#    QUEST_V27_FLOW=false (default — jangan on dulu)
#    CANTON_WALLET_PROVIDER_PARTY_ID=<sama dgn VALIDATOR_PARTY_ID>
#    CANTON_APP_PROVIDER_PARTY_ID=<app-canquest party>

# 4. Upload DAR v27 ke participant (§3)

# 5. Update CANTON_DAML_PACKAGE_NAME ke hash v27 (§4)

# 6. Build + restart backend
npm run build && pm2 restart canquest-api --update-env

# 7. Test bertahap (§6 test matrix — PATH A duluan, amount kecil)
```

---

## §1. Pre-flight checklist (WAJIB sebelum deploy)

```bash
# A. Verify branch merged + 6 commit Fase 2 ada
cd /var/www/canquest
git log --oneline -6
# Expected:
#   d5cc2ca feat(api): v27 PATH B wiring + hardening
#   f89bf2a feat(api): v27 PATH B ledger methods (AppPaymentRequest flow)
#   8497651 feat(api): v27 reward flow routing + PATH A caller integration
#   71db1e0 feat(api): v27 PATH A ledger methods
#   454fa04 feat(db): v27 payment tracking columns (nullable)
#   e1808ad docs: fix handoff accuracy

# B. Verify DAR v27 sudah ada (sudah dibuild kemarin)
ls -la packages/daml/.daml/dist/canquest-v27-*.dar
# Expected: canquest-v27-1.4.0.dar (~700KB)
# Kalau tidak ada: cd packages/daml && daml build

# C. Verify env vars critical
grep -E "CANTON_VALIDATOR_PARTY_ID|CANTON_REWARD_PARTY_ID|CANTON_FEE_RECIPIENT_PARTY_ID|CANTON_APP_PROVIDER_PARTY_ID|CANTON_DSO_PARTY_ID" apps/api/.env
# Semua harus non-empty.

# D. Verify REWARD_SENDER funded (MAINNET — cek saldo real)
REWARD_PARTY=$(grep CANTON_REWARD_PARTY_ID apps/api/.env | cut -d'"' -f2)
# GET https://validator.canquestlabs.com/v0/admin/amulet/balance/$REWARD_PARTY
# Saldo harus cukup utk test (≥ rewardCc × test_slots + buffer)
```

---

## §2. DB Migration (zero-risk, nullable columns)

```bash
cd /var/www/canquest/apps/api
npx prisma migrate deploy
# Expected: applied migration 20260809120000_add_v27_payment_tracking

# Verify columns ada
psql "$DATABASE_URL" -c "\d \"WinnerDraw\"" | grep -E "rewardPath|questPaymentRequestCid|appPaymentRequestCid|paymentAcceptedAt|paymentCollectedAt|paymentExpiredReason"
# Expected: 6 baris baru, semua nullable.

# Verify existing rows tidak terdampak (semua NULL di kolom baru)
psql "$DATABASE_URL" -c 'SELECT COUNT(*) FROM "WinnerDraw" WHERE "rewardPath" IS NOT NULL;'
# Expected: 0 (rows lama tidak berubah)
```

---

## §3. Upload DAR v27 ke Participant (MAINNET)

⚠️ Pakai URL **public** `https://ledger.canquestlabs.com`, BUKAN Docker internal IP.

```bash
PARTICIPANT="https://ledger.canquestlabs.com"
KEYCLOAK_URL="https://auth.canquestlabs.com"
YOUR_SECRET="<LEDGER_CLIENT_SECRET dari .env>"
DAR_PATH="/var/www/canquest/packages/daml/.daml/dist/canquest-v27-1.4.0.dar"

# Ambil token admin
ADMIN_TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/canton/protocol/openid-connect/token" \
  -d "client_id=validator-app-backend" -d "client_secret=$YOUR_SECRET" \
  -d "grant_type=client_credentials" -d "scope=daml_ledger_api" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "Token length: ${#ADMIN_TOKEN}"   # harus ~1446

# Upload — TUNGGU sampai selesai (jangan Ctrl+C)
curl -i -X POST "$PARTICIPANT/v2/dars" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"$DAR_PATH"

# Expected: 200 OK. Catat package hash dari response — dibutuhkan di §4.
```

**Kalau gagal 409 Conflict:** DAR v27 sudah pernah di-upload. Aman — lanjut §4 utk ambil hash existing.

---

## §4. Resolve CANTON_DAML_PACKAGE_NAME ke hash v27

Setelah upload, backend harus tahu package hash v27 (BUKAN string `canquest-v27`).

```bash
# Query DAR list di participant utk dapat hash
curl -s "$PARTICIPANT/v2/dars" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | python3 -c "
import sys, json
dars = json.load(sys.stdin)
for d in dars:
    if 'canquest-v27' in d.get('packageId', '') or 'canquest' in d.get('description', '').lower():
        print(f\"packageId={d['packageId']}\")
        print(f\"  description={d.get('description','')}\")
"

# Cari entry dgn description mengandung 'canquest-v27' atau Main:QuestPaymentRequest.
# Catat packageId (hash hex, mis. 'a1b2c3d4...').

# Set di .env:
#   CANTON_DAML_PACKAGE_NAME="#a1b2c3d4..."   (prefix #, BUKAN #canquest-v27)
```

⚠️ **Critical:** Jika `CANTON_DAML_PACKAGE_NAME` masih default `#canquest-v27`, backend akan resolve template ID ke `#canquest-v27:Main:QuestPaymentRequest` — ini **TIDAK valid** di Ledger API (butuh hash hex). Harus pakai hash aktual.

---

## §5. Verify CanActAs rights (MAINNET — paling sering gagal)

Service account (LEDGER_API_ADMIN_USER) butuh CanActAs untuk SEMUA party di actAs arrays.

```bash
# Daftar party yang butuh CanActAs:
#   - CANTON_VALIDATOR_PARTY_ID (operator/admin)
#   - CANTON_REWARD_PARTY_ID
#   - CANTON_FEE_RECIPIENT_PARTY_ID
#   - CANTON_APP_PROVIDER_PARTY_ID
#   - user party IDs (otomatis granted saat register)

# Cek rights per party (lihat docs/RUNBOOK_GRANT_ANY_PARTY_RIGHTS.md utk detail)
# PATH A butuh: [operator, user, rewardSender] (+ appProvider bila FAR on)
# PATH B butuh:
#   createAppPaymentRequest: [operator, rewardSender, appProvider, user, feeReceiver] (5-party)
#   acceptAppPaymentRequest: [rewardSender, walletProvider] (2-party)
#   collectAcceptedAppPayment: [rewardSender, appProvider, user, feeReceiver] (4-party)
```

⚠️ **PATH B lebih ketat dari PATH A** — butuh 5-party + 4-party + 2-party di 3 step berbeda. Pastikan semua granted sebelum enable PATH B.

---

## §6. Test Matrix — PATH A duluan (MAINNET, amount kecil)

> ⚠️ **MAINNET = real CC.** Pakai amount kecil utk test pertama (mis. rewardCc=1 CC).
> Buat campaign test khusus dgn rewardCc kecil + maxWinners=1.

### Pre-test: quest test setup

1. Buat 1 quest test di dashboard: `questKind=CC_FCFS`, `rewardCc=1`, `claimFeeCc=1`, `maxWinners=1`.
2. Pre-fund REWARD_SENDER dgn ≥ 2 CC (reward + buffer).
3. User test harus punya ≥ 1 CC utk bayar fee + punya preapproval aktif (utk PATH A test).
4. Verify user preapproval:
   ```bash
   curl -s "https://validator.canquestlabs.com/v0/admin/transfer-preapprovals/by-party/$USER_PARTY" \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   # Expected: ada response dgn expiresAt > now → PATH A eligible
   ```

### TEST 1 — PATH A happy path (CC + preapproval ON)

```bash
# A. Enable v27 flow GLOBAL (atau per-quest kalau ada override)
#    Di .env:
QUEST_V27_FLOW="true"
pm2 restart canquest-api --update-env

# B. User claim reward via API
curl -X POST "https://api.canquestlabs.com/quests/$QUEST_ID/claim-fcfs" \
  -H "Authorization: Bearer $USER_JWT"
# Expected: 200 OK, rewardDelivery='direct'

# C. Verify on-chain
#    1. PlatformTransfer contract status=SETTLED
#    2. QuestPaymentRequest contract status=PENDING (audit, tidak MarkSettled di PATH A)
#    3. WinnerDraw DB: rewardPath='V27_PATH_A', ledgerTxId non-null

psql "$DATABASE_URL" -c \
  'SELECT "rewardPath", "ledgerTxId", "questPaymentRequestCid", "distributed" FROM "WinnerDraw" WHERE "questId"='\''$QUEST_ID'\'';'
# Expected: rewardPath=V27_PATH_A, distributed=true

# D. Verify balance: user +1 CC reward, -1 CC fee → net 0 CC (atau sesuai reward-fee)
#    feeParty +1 CC. rewardSender -1 CC.
```

**Kalau TEST 1 GAGAL:**
- `Set QUEST_V27_FLOW=false + restart` → fallback ke v25 (aman, verified).
- Lihat log: `pm2 logs canquest-api --lines 100 | grep -i "v27\|PATH A\|ExecuteTransfer"`
- Common errors:
  - `INSUFFICIENT_HOLDINGS` → REWARD_SENDER underfunded
  - `PARTY_NOT_AUTHORIZED` / `CanActAs` → grant rights (§5)
  - `CONTRACT_NOT_ACTIVE` → race condition holdings (sudah di-fix via partition logic, tapi verify)

### TEST 2 — PATH B happy path (CC + preapproval OFF atau USDCx)

> Setelah TEST 1 verified. Pakai user lain yang preapproval OFF, atau test dgn USDCx.

```bash
# A. User B (preapproval OFF) atau user A dgn USDCx quest
#    Disable preapproval user A utk test fallback:
curl -X DELETE "https://validator.canquestlabs.com/v0/admin/transfer-preapprovals/by-party/$USER_A_PARTY" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# B. User claim reward
curl -X POST "https://api.canquestlabs.com/quests/$QUEST_ID/claim-fcfs" \
  -H "Authorization: Bearer $USER_A_JWT"
# Expected: 200 OK (sync Accept — user tidak perlu manual accept)

# C. Verify on-chain
#    1. AppPaymentRequest created lalu archived (consumed by Accept)
#    2. AcceptedAppPayment created lalu archived (consumed by Collect)
#    3. QuestPaymentRequest status=SETTLED (MarkSettled jalan di PATH B)
#    4. WinnerDraw DB: rewardPath='V27_PATH_B', paymentAcceptedAt + paymentCollectedAt non-null

psql "$DATABASE_URL" -c \
  'SELECT "rewardPath", "appPaymentRequestCid", "paymentAcceptedAt", "paymentCollectedAt", "distributed" FROM "WinnerDraw" WHERE "questId"='\''$QUEST_ID'\'';'
# Expected: rewardPath=V27_PATH_B, distributed=true, timestamps non-null
```

**Kalau TEST 2 GAGAL** (lebih kompleks dari TEST 1):
- `Set QUEST_V27_FLOW=false + restart` → fallback v25.
- Common PATH B errors:
  - `AppPaymentRequest create: PARTY_NOT_AUTHORIZED` → 5-party CanActAs belum complete (§5)
  - `AppPaymentRequest_Accept: INSUFFICIENT_HOLDINGS` → REWARD_SENDER underfunded (funding dari sender, bukan user)
  - `AcceptedAppPayment_Collect: PARTY_NOT_AUTHORIZED` → 4-party signatory kurang (§5)
  - `MarkAccepted/MarkSettled fail` → non-fatal (Collect sudah committed, lihat log warn)

### TEST 3 — Rollback safety

```bash
# Verify QUEST_V27_FLOW=false benar-benar fallback ke v25
QUEST_V27_FLOW="false"
pm2 restart canquest-api --update-env

# User claim lagi → harus pakai v25 settleAtomic (rewardPath=NULL atau 'V25_SETTLE')
curl -X POST "https://api.canquestlabs.com/quests/$QUEST_ID/claim-fcfs" \
  -H "Authorization: Bearer $USER_JWT"
# Expected: 200 OK, rewardPath NULL (v25 path)
```

---

## §7. Post-test: enable permanent (jika semua TEST pass)

```bash
# Set QUEST_V27_FLOW=true permanent di .env production
QUEST_V27_FLOW="true"
pm2 restart canquest-api --update-env

# Monitor 24 jam pertama
pm2 logs canquest-api | grep -iE "v27|PATH [AB]|AppPaymentRequest|ExecuteTransfer"
# Watch utk error: PARTY_NOT_AUTHORIZED, INSUFFICIENT_HOLDINGS, CONTRACT_NOT_ACTIVE
```

---

## §8. Troubleshooting

### Error: `CANTON_WALLET_PROVIDER_PARTY_ID required for PATH B`
→ Set env var. Biasanya sama dgn `CANTON_VALIDATOR_PARTY_ID`:
```bash
CANTON_WALLET_PROVIDER_PARTY_ID="<sama dgn CANTON_VALIDATOR_PARTY_ID>"
```

### Error: `Failed to resolve Splice disclosed contracts`
→ `fetchScanProxyContract` gagal. Cek:
- `CANTON_SCAN_URL` atau `CANTON_VALIDATOR_URL` reachable
- scan-proxy endpoint `/amulet-rules` dan `/open-and-issuing-mining-rounds` return 200

### Error: PATH A `Amount harus > 0!` (DAML assertion)
→ `rewardAmount <= 0`. CODE claim (reward=0) harus fallback v25 — pastikan caller branch `rewardCc > 0` benar.

### Error: QuestPaymentRequest create `templateId tidak ditemukan`
→ `CANTON_DAML_PACKAGE_NAME` masih `#canquest-v27` (string), harus hash hex aktual (§4).

---

## §9. Setelah verified — Step 7 (v25 cleanup)

Lihat `HANDOFF_DAML_V27.md` NEXT STEP. Setelah PATH A + B verified ≥ 1 minggu stabil:

1. Hapus v25 legacy: `settleAtomic`, `recordTxId`, `TPL.QuestClaimReceipt`, `useAtomicSettle`, `settleAndRecord` v25.
2. Hapus `QuestClaimReceipt` template dari DAML (DAR version bump v1.5.0).
3. Hapus flag `QUEST_V27_FLOW` (v27 jadi default).
4. Update `HANDOFF_DAML_V27.md` status → DONE.

---

## Referensi

- `HANDOFF_DAML_V27.md` — status + plan keseluruhan
- `docs/V27_MASTER_FLOW_REFERENCE.md` — master flow dari Canton AI (source of truth)
- `docs/RUNBOOK_DAML_V25_DEPLOY.md` — deploy v25 (history, pattern upload DAR)
- `docs/RUNBOOK_GRANT_ANY_PARTY_RIGHTS.md` — grant CanActAs rights
- `docs/WALLET_USER_PROXY_SETUP.md` — party list + config
