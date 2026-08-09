# Guide — Cutover v27 Mainnet (Step-by-Step)

> **Tujuan:** Transisi production dari v25 → v27 reward flow di MAINNET, langkah per langkah.
> Setiap step punya command + expected output + cek sebelum lanjut.
>
> **Branch:** `master` (fix `54ac6ad` wajib sudah merge)
> **DAR on-chain:** v1.4.0 (hash `ecc96baa061d565e6d9622e74281304ac91f1bfc0527c6d978664bed515a2d03`)

---

## ⏱️ Estimasi waktu & impact

- **Downtime:** ~2-3 menit (saat `pm2 restart` di Step 5)
- **Risk window:** Ada window berbahaya antara "hash v27 + flag false" → semua claim gagal
  (v25 fallback butuh QuestClaimReceipt yang tidak ada di DAR v27).
  **Step 4+5 harus dilakukan bersamaan** (atomic cutover).
- **Rollback:** Selalu mungkin (DAR v25 masih on-chain, Canton tidak hapus package lama).

---

## FASE 1 — VERIFIKASI STATE VPS (read-only, aman)

> Goal: Pastikan code VPS punya fix `54ac6ad`. Tanpa ini, cutover akan break claim.

### Step 1.1 — Cek commit code VPS

```bash
cd /var/www/canquest
git log --oneline -1
```

**Expected output:**
- ✅ `54ac6ad fix(api): v27 ClaimSlot/DrawWinner signature compatibility` → LANJUT Step 2
- ❌ Commit lain (mis. `d477396`) → **HENTIKAN**, jalankan Step 1.2 dulu

### Step 1.2 — (Hanya kalau Step 1.1 bukan 54ac6ad) Pull fix

```bash
cd /var/www/canquest
git fetch origin master
git log --oneline origin/master -3
# Expected: 54ac6ad ada di paling atas

git pull origin master
git log --oneline -1
# Expected: 54ac6ad fix(api): v27 ClaimSlot/DrawWinner signature compatibility
```

✅ Setelah ini, LANJUT Step 1.3.

### Step 1.3 — Verify working tree clean + build OK

```bash
cd /var/www/canquest/apps/api
git status --short
# Expected: KOSONG (tidak ada modified files). Kalau ada, stash dulu.

npm run build 2>&1 | tail -5
# Expected: tidak ada error, ends with build success
```

✅ Build clean → LANJUT FASE 2.

---

## FASE 2 — SETUP PRE-REQUISITE TEST (sebelum cutover)

> Goal: Siapkan quest test + verify user preapproval + verify REWARD_SENDER funded.
> Lakukan saat v25 masih jalan normal (sebelum cutover).

### Step 2.1 — Dapat admin token (akan dipakai di step berikut)

```bash
cd /var/www/canquest/apps/api
SECRET=$(grep -E "^LEDGER_CLIENT_SECRET=" .env | sed -E 's/^[^=]+=//; s/^"//; s/"$//')
ADMIN_TOKEN=$(curl -s -X POST "https://auth.canquestlabs.com/realms/canton/protocol/openid-connect/token" \
  -d "client_id=validator-app-backend" -d "client_secret=$SECRET" \
  -d "grant_type=client_credentials" -d "scope=daml_ledger_api" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
echo "Token len: ${#ADMIN_TOKEN}"
# Expected: Token len: 1446
```

⚠️ Kalau token len bukan 1446, HENTIKAN — auth bermasalah.

### Step 2.2 — Verify REWARD_SENDER funded (WAJIB sebelum test)

```bash
REWARD_PARTY=$(grep -E "^CANTON_REWARD_PARTY_ID=" .env | sed -E 's/^[^=]+=//; s/^"//; s/"$//')
echo "Reward party: $REWARD_PARTY"

curl -s "https://validator.canquestlabs.com/v0/admin/transfer-preapprovals/by-party/$REWARD_PARTY" \
  -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null
# Cek saldo via Splice balance endpoint (atau pakai API internal CanQuest)
curl -s "http://localhost:3001/api/admin/wallets/balance?username=canquest-reward-user" \
  -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null \
  || echo "Cek saldo via dashboard admin: REWARD_SENDER (canquest-reward-user)"
```

**Expected:** Saldo REWARD_SENDER ≥ 2 CC (utk test rewardCc=1 + feeCc=1 + buffer).
❌ Kalau saldo < 2 CC → **topup dulu** sebelum lanjut.

### Step 2.3 — Pilih user test + verify preapproval ON (utk PATH A)

```bash
# Ganti dgn party ID user test Anda (yang sudah register + punya CC)
USER_PARTY="<masukkan-party-id-user-test>"

curl -s "https://validator.canquestlabs.com/v0/admin/transfer-preapprovals/by-party/$USER_PARTY" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Expected:** Response berisi JSON dgn `transfer_preapproval` + `expiresAt`.
- ✅ Ada preapproval + expiresAt > now → **PATH A eligible**, lanjut
- ❌ Kosong / 404 → user belum setup preapproval → PATH A tidak akan jalan, hanya PATH B
  (PATH B test butuh USDCx atau pakai user lain preapproval OFF)

### Step 2.4 — Buat quest test (via dashboard admin CanQuest)

1. Login dashboard admin (`https://app.canquestlabs.com` atau dashboard Anda)
2. Buat quest baru:
   - **questKind:** `CC_FCFS`
   - **rewardCc:** `1` (kecil!)
   - **claimFeeCc:** `1`
   - **maxWinners:** `1`
   - **eligibilityType:** `NONE` (simplest)
3. **Aktifkan quest** (status → ACTIVE)
4. Catat `questId` (dari URL atau response API)

✅ Catat `questId` + `USER_PARTY` → LANJUT FASE 3.

---

## FASE 3 — CUTOVER v27 (atomic, ~2-3 menit downtime)

> ⚠️ **WINDOW BERBAHAYA:** Setelah Step 3.1 (set hash v27), sampai Step 3.3 (set flag true + restart),
> **semua claim user AKAN GAGAL**. Lakukan 3.1→3.3 secepat mungkin, idealnya saat traffic rendah.
>
> **Rekomendasi:** Maintenance mode / announcement "Claim sedang maintenance" selama cutover.

### Step 3.1 — Set CANTON_DAML_PACKAGE_NAME ke hash v27

```bash
cd /var/www/canquest/apps/api

# Backup .env dulu (safety)
cp .env .env.backup-v27-cutover-$(date +%s)

# Set hash v27
sed -i 's|^CANTON_DAML_PACKAGE_NAME=.*|CANTON_DAML_PACKAGE_NAME="#ecc96baa061d565e6d9622e74281304ac91f1bfc0527c6d978664bed515a2d03"|' .env

# Verify
grep CANTON_DAML_PACKAGE_NAME .env
# Expected: CANTON_DAML_PACKAGE_NAME="#ecc96baa061d565e6d9622e74281304ac91f1bfc0527c6d978664bed515a2d03"
```

⚠️ **JANGAN restart dulu.** Claim masih jalan via v25 (env cache lama masih loaded di memory backend). Lanjut Step 3.2.

### Step 3.2 — Set QUEST_V27_FLOW=true

```bash
# Set flag true
if grep -q "^QUEST_V27_FLOW=" .env; then
  sed -i 's|^QUEST_V27_FLOW=.*|QUEST_V27_FLOW="true"|' .env
else
  echo 'QUEST_V27_FLOW="true"' >> .env
fi

# Verify (harus ada KEDUA baris ini)
grep -E "^CANTON_DAML_PACKAGE_NAME=|^QUEST_V27_FLOW=" .env
# Expected:
#   CANTON_DAML_PACKAGE_NAME="#ecc96baa061d565e6d9622e74281304ac91f1bfc0527c6d978664bed515a2d03"
#   QUEST_V27_FLOW="true"
```

### Step 3.3 — Build + restart (ATOMIC cutover)

```bash
npm run build 2>&1 | tail -3
# Expected: build success (no error)

pm2 restart canquest-api --update-env
sleep 3
curl -s http://localhost:3001/api/health
# Expected: 200 OK / health response
```

✅ Health OK → LANJUT Step 3.4 verify startup log.
❌ Health fail / backend crash → **ROLLBACK SEKARANG** (lihat FASE 6).

### Step 3.4 — Verify startup log bersih

```bash
pm2 logs canquest-api --lines 30 --nostream 2>&1 | grep -iE "error|fail|warn|started|Nest"
```

**Expected:**
- ✅ `Nest application successfully started` atau serupa
- ✅ Tidak ada `Cannot find module` / `dependency injection error`
- ⚠️ Warning OK (mis. `CANTON_OPERATOR_PARTY_ID unset — fallback validator`)

❌ Ada error fatal (`EADDRINUSE`, `MODULE_NOT_FOUND`, dll) → **ROLLBACK** (FASE 6).

---

## FASE 4 — TEST CLAIM v27 (PATH A, amount kecil)

> Goal: 1 claim reward test pakai user preapproval ON → verify PATH A jalan.

### Step 4.1 — Dapat JWT user test

```bash
# Login sebagai user test via API (ganti credentials)
USER_EMAIL="<email-user-test>"
USER_PASS="<password-user-test>"

USER_JWT=$(curl -s -X POST "http://localhost:3001/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASS\"}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token') or d.get('token') or d)")

echo "JWT len: ${#USER_JWT}"
# Expected: > 100 (JWT string)
```

### Step 4.2 — (Optional) Pre-check eligibility

```bash
QUEST_ID="<questId-dari-Step-2.4>"

curl -s "http://localhost:3001/api/quests/$QUEST_ID/claim-eligibility" \
  -H "Authorization: Bearer $USER_JWT"
# Expected: { "eligible": true, ... }
```

### Step 4.3 — TEST CLAIM (the moment of truth)

```bash
curl -s -X POST "http://localhost:3001/api/quests/$QUEST_ID/claim-fcfs" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json"
```

**Expected:**
- ✅ `200 OK` dgn `{ "ok": true, "rewardDelivery": "direct", ... }` → **PATH A SUCCESS!** Lanjut Step 4.4
- ❌ Error (4xx/5xx) → catat error response, LANJUT Step 4.5 (diagnostic)

### Step 4.4 — Verify on-chain + DB (PATH A success)

```bash
# A. Cek WinnerDraw DB
psql "$DATABASE_URL" -c \
  "SELECT \"rewardPath\", \"ledgerTxId\", \"questPaymentRequestCid\", \"distributed\", \"distributedAt\" FROM \"WinnerDraw\" WHERE \"questId\"='$QUEST_ID';"
# Expected:
#   rewardPath = V27_PATH_A
#   ledgerTxId = non-null (Canton updateId)
#   questPaymentRequestCid = non-null
#   distributed = t
#   distributedAt = timestamp baru

# B. Cek log backend
pm2 logs canquest-api --lines 50 --nostream 2>&1 | grep -iE "v27|PATH A|ExecuteTransfer|QuestPaymentRequest"
# Expected: log "v27 PATH A ExecuteTransfer OK: settled=... updateId=..."
```

🎉 **PATH A VERIFIED!** v27 jalan di mainnet.

### Step 4.5 — Diagnostic (kalau Step 4.3 error)

```bash
# A. Lihat error response dari claim (sudah di Step 4.3)
# B. Lihat full log backend saat claim
pm2 logs canquest-api --lines 80 --nostream 2>&1 | grep -iE "claim|v27|PATH|error|fail|ExecuteTransfer|AppPaymentRequest"
```

**Common errors + kemungkinan cause:**

| Error | Kemungkinan cause | Fix |
|---|---|---|
| `Template Main:QuestPaymentRequest not found` | Package hash salah / DAR v27 belum vetted | Verify hash, cek vetting |
| `INSUFFICIENT_HOLDINGS` | REWARD_SENDER kosong | Topup REWARD_SENDER |
| `PARTY_NOT_AUTHORIZED` / `CanActAs` | Service account kurang rights | Grant rights (RUNBOOK_GRANT_ANY_PARTY_RIGHTS.md) |
| `CONTRACT_NOT_ACTIVE` | Race condition holdings | Cek log detail |
| `rewardAmount must be > 0` | rewardCc=0 (CODE claim) | Pakai quest rewardCc>0 |

❌ Kalau tidak bisa fix cepat → **ROLLBACK** (FASE 6) → investigasi → coba lagi nanti.

---

## FASE 5 — MONITORING (24 jam pertama)

> Goal: Pastikan v27 stabil. Watch error pattern.

### Step 5.1 — Monitor log real-time (jalankan di screen/tmux)

```bash
pm2 logs canquest-api --lines 0 | grep -iE "v27|PATH [AB]|claim|error|fail"
```

### Step 5.2 — Cek periodic (tiap 1-2 jam pertama)

```bash
# Cek ada error claim ga?
pm2 logs canquest-api --lines 200 --nostream 2>&1 | grep -icE "claim.*fail|v27.*fail|PATH.*fail"
# Expected: 0 (atau sedikit, investigasi)

# Cek ada WinnerDraw stuck (distributed=false setelah > 10 menit)?
psql "$DATABASE_URL" -c \
  "SELECT COUNT(*) FROM \"WinnerDraw\" WHERE \"distributed\"=false AND \"drawnAt\" < NOW() - INTERVAL '10 minutes';"
# Expected: 0
```

---

## FASE 6 — ROLLBACK (kalau gagal, pakai ini)

> ⚠️ Rollback ke v25 mode. DAR v25 masih on-chain (Canton tidak hapus package lama).

```bash
cd /var/www/canquest/apps/api

# Kembalikan package name ke v25 + flag false
sed -i 's|^CANTON_DAML_PACKAGE_NAME=.*|CANTON_DAML_PACKAGE_NAME="#canquest-v25"|' .env
sed -i 's|^QUEST_V27_FLOW=.*|QUEST_V27_FLOW="false"|' .env

# Verify
grep -E "^CANTON_DAML_PACKAGE_NAME=|^QUEST_V27_FLOW=" .env
# Expected:
#   CANTON_DAML_PACKAGE_NAME="#canquest-v25"
#   QUEST_V27_FLOW="false"

# Build + restart
npm run build && pm2 restart canquest-api --update-env

# Verify v25 jalan lagi
sleep 3
curl -s http://localhost:3001/api/health
pm2 logs canquest-api --lines 20 --nostream
```

✅ Setelah rollback, produksi kembali aman di v25. Investigasi issue, fix, coba cutover lagi nanti.

---

## CHECKLIST RINGKAS (print this)

```
FASE 1 (verify VPS state):
  [ ] git log -1 = 54ac6ad  (atau pull dulu)
  [ ] git status clean
  [ ] npm run build OK

FASE 2 (setup test):
  [ ] Dapat admin token (len 1446)
  [ ] REWARD_SENDER funded ≥ 2 CC
  [ ] User test preapproval ON (utk PATH A)
  [ ] Quest test dibuat (rewardCc=1, ACTIVE), catat questId

FASE 3 (cutover atomic — traffic stop recommended):
  [ ] Backup .env
  [ ] Set CANTON_DAML_PACKAGE_NAME = hash v1.4.0
  [ ] Set QUEST_V27_FLOW = true
  [ ] npm run build + pm2 restart
  [ ] Health check OK
  [ ] Startup log bersih

FASE 4 (test claim):
  [ ] User test login (dapat JWT)
  [ ] POST /quests/:id/claim-fcfs
  [ ] Response 200 OK dgn rewardDelivery=direct
  [ ] DB: rewardPath=V27_PATH_A, ledgerTxId non-null
  [ ] Log: "v27 PATH A ExecuteTransfer OK"

FASE 5 (monitor):
  [ ] Watch log 1-2 jam pertama
  [ ] Tidak ada error claim massive

ROLLBACK READY (kalau perlu):
  [ ] Command FASE 6 siap copy-paste
```
