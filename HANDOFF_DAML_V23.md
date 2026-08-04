# HANDOFF — DAML v23 + Backend Atomic Settle Refactor

> **Tujuan dokumen:** Resume pekerjaan di chat baru tanpa kehilangan konteks.
> Sertakan dokumen ini (atau paste isinya) di awal chat baru.
>
> **Tanggal:** 2026-08-04
> **Branch:** `master` (clean, semua sudah commit + push)
> **Commit terakhir:** `d060b9a`

---

## 1. APA YANG SUDAH SELESAI (verified working)

### DAML v23 — sudah live di participant node (VPS 1)
- Package `canquest-v23` (version 1.1.0), SDK 3.4.11, sudah upload ke participant
  (125 packages total di node, +1 = canquest-v23)
- 3 template: `WalletRegistration`, `QuestCampaign`, `QuestClaimReceipt`
- DAR dependencies 4 splice-api-* dari bundle v0.6.12 (match node) sudah di
  `packages/daml/dars/`
- **Test 7/7 PASS** (script `scripts/test-dar-v22.sh` — perlu update ke v23):
  create Wallet, create Campaign, ClaimSlot, anti-sybil guard, EndCampaign,
  Close, fee-first guard — semua jalan
- Contract test dummy sudah di-cleanup (script `scripts/cleanup-test-dummies.sh`)

### Backend refactor — sudah commit, belum deploy penuh
- `apps/api/src/canton/quest-ledger.service.ts`:
  - TPL map: `QuestClaim` → `QuestClaimReceipt`
  - `damlPackageRef` default `#canquest-v23`
  - Rename choices: `ClaimFcfsSlot`→`ClaimSlot`, `DrawRaffleWinner`→`DrawWinner`,
    `RevealRewardCode`→`RevealCode`
  - `createQuestCampaign` tambah field `rewardToken` ('CC'|'USDCx'|null)
  - **HAPUS** `atomicFeeAndReward`
  - **BARU** `settleAtomic()` — nested-exercise Settle choice (atomic fee+reward)
  - **BARU** `recordTxId()` — post-settle tx id
  - **BARU** `greedyFillHoldings()` helper
  - **BARU** `extractUpdateId()` helper
- `apps/api/src/quests/quests.service.ts`:
  - **BARU** `settleAndRecord()` helper — atomic path (settleAtomic + C1 + recordTxId + history)
  - **BARU** `useAtomicSettle` getter (flag `QUEST_ATOMIC_SETTLE`)
  - **BARU** `rewardPartyId` + `feeTargetPartyId` getter (sudah ada sebelumnya)
  - 4 claim method restruktur dgn branch atomic vs fallback:
    - `claimFcfsReward`
    - `claimDrawCcReward`
    - `claimCcAndCodeRaffleReward`
    - `claimInviteReward` (fee-only Settle, rewardAmount=0, reward=None)
  - Fallback path (non-atomic, v21-style) di-belakang flag
  - Build API **OK** (nest build clean, no TS errors)
- `infra/env/*.example`: `CANTON_DAML_PACKAGE_NAME=canquest-v23` + `QUEST_ATOMIC_SETTLE=true`

### Canton AI kolaborasi — sudah selesai
- Arsitektur DAML v22/v23 (3 template + atomic Settle)
- Atomicity fee+reward verified SOLID (single transaction tree)
- Pattern signatures (TransferFactory_Transfer, ExtraArgs, FAR)
- Review DAML v22 (5 bug fix)
- DAR dependencies source (bundle splice-node v0.6.12)

---

## 2. STATUS SAAT INI — DEPLOY + TEST REAL

### Yang sudah ter-test di production (log VPS 2):
User `@karel` claim FCFS quest `cmsdv2fz` (reward 1 CC, fee 0.1 CC):
- ✅ QuestCampaign created (dgn rewardToken field baru)
- ✅ ClaimSlot OK (DAML v23 rename jalan)
- ✅ Registry call fee leg sukses (kind=direct, disclosed=5)
- ✅ Registry call reward leg sukses (kind=offer, disclosed=4)
- ❌ **Settle choice FAIL**: `Missing non-optional fields: Set(context, meta)`

### Fix terakhir (commit `d060b9a`, BELUM di-deploy ke VPS 2):
Bug: `feeExtraArgs.context` null untuk direct transfer (kind=direct),
DAML ExtraArgs record butuh context + meta non-optional.
Fix: `safeContext()` helper default ke `{ values: {} }` bila choiceContextData kosong.
Pattern sama `executeTransferFactoryTransfer` (canton-ledger.service.ts:597).

### Yang harus dilakukan berikutnya:
1. **Deploy fix ke VPS 2**:
   ```bash
   cd /var/www/canquest && git pull origin master
   cd apps/api && npm run build && pm2 restart canquest-api --update-env
   ```
2. **Test claim FCFS baru** (quest baru atau user lain)
3. Monitor log — cari `Settle OK` (kalau fix berhasil) atau error baru
4. Kalau masih error Settle, paste log ke chat baru

### Catatan penting soal log sebelumnya:
Setelah Settle gagal, log lanjutan menunjukkan `TransferFactory_Transfer OK`
(fee 0.1 CC ke canquest-fee) + reward offer pending ke karel. Ini terjadi
karena user RETRY — setelah Settle throw, claim fail, user coba lagi dan
entah kenapa masuk path lama. PERLU di-verify apakah ada bug di mana Settle
fail tapi code lanjut ke fallback (tidak seharusnya — Settle fail harus throw).

---

## 3. TODO YANG BELUM SELESAI

### High priority
- [ ] **Deploy fix `d060b9a` ke VPS 2** + test Settle real (cek context/meta fix)
- [ ] **Kalau Settle masih gagal**, kemungkinan error berikutnya:
  - `transfer.sender` authorization (actAs belum cover semua party)
  - `inputHoldingCids` empty (holding insufficient)
  - DAML Optional encoding `{tags:'Some',value}` format salah
  - Paste log error, fix iteratif
- [ ] **Update `scripts/test-dar-v22.sh`** ke v23 (package name + test fee-only Settle)

### Medium priority
- [ ] **Validasi minimum reward CC** — user minta bisa isi 0.1 CC (bukan minimum 1).
      Cari di `apps/api/src/admin/dto/` atau `admin.service.ts` validation.
      Mungkin `@Min(1)` atau `rewardMicroCc` BigInt precision issue.
- [ ] **Investigate**: Settle fail tapi code lanjut ke fallback? Cek flow
      `claimFcfsReward` — Settle harus throw, tidak boleh fallback otomatis.
- [ ] Cleanup contract test dummy WalletRegistration (create-only, tidak bisa archive)

### Low priority / future
- [ ] Aktifkan FAR (Canton Foundation approve FeaturedAppRight untuk app-canquest)
- [ ] Setup staging/testnet utk test lebih aman sebelum production change
- [ ] Dokumentasi internal: arsitektur DAML v23 + flow atomic

---

## 4. ROLLBACK PLAN (kalau emergency)

```bash
# Edit apps/api/.env di VPS 2:
QUEST_ATOMIC_SETTLE=false

# Restart API:
cd /var/www/canquest/apps/api && pm2 restart canquest-api --update-env
```

Setelah ini, semua claim pakai **fallback path** (collectClaimFee + sendReward
terpisah, non-atomic seperti v21). DAML v23 tetap live di node tapi tidak dipakai
untuk Settle — hanya ClaimSlot/DrawWinner/RevealCode (yang sudah verified jalan).

DAR v22/v23 tidak bisa di-unvet dari node (Canton limitation), tapi harmless —
tidak mengganggu apa-apa.

---

## 5. KEY FILES UNTUK REFERENSI

| File | Isi |
|---|---|
| `packages/daml/daml/Main.daml` | DAML v23 (3 template + atomic Settle + Optional reward) |
| `packages/daml/daml.yaml` | package canquest-v23, data-dependencies 4 DAR |
| `packages/daml/README.md` | Build/extract/deploy/switch instructions |
| `apps/api/src/canton/quest-ledger.service.ts` | settleAtomic() + recordTxId() + rename choices |
| `apps/api/src/canton/canton-ledger.service.ts` | Helper CIP-56 (callTransferFactoryRegistry, exerciseChoice, queryAmuletHoldings) |
| `apps/api/src/quests/quests.service.ts` | 4 claim method + settleAndRecord helper + useAtomicSettle flag |
| `scripts/test-dar-v22.sh` | Test DAR di participant (perlu update ke v23) |
| `scripts/cleanup-test-dummies.sh` | Archive contract test dummy |
| `scripts/fetch-daml-deps.sh` | Download DAR splice-api dari bundle GitHub |
| `scripts/check-v21-active-contracts.sh` | Cek contract aktif di ledger |
| `scripts/check-parties.sh` | Dump party ID dari .env + verify di ledger |
| `scripts/inspect-dar.sh` | Inspect module path + type di DAR Splice |
| `ONCHAIN_INVENTORY_FOR_DAML.md` | Inventory operasi onchain dapp (bahan DAML) |
| `DAPP_FUNCTIONS_AND_FAR.md` | Fungsi per menu + status FAR |
| `PROMPT_CANTON_*.md` | Prompt ke Canton AI (arsitektur, signatures, review, atomicity) |

---

## 6. PARTY IDs (production, dari .env VPS 2)

```
CANTON_OPERATOR_PARTY_ID     = canquest-operator::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
CANTON_VALIDATOR_PARTY_ID    = canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
CANTON_DSO_PARTY_ID          = DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc
CANTON_REWARD_PARTY_ID       = canquest-reward-user::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
CANTON_FEE_RECIPIENT_PARTY_ID = canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
CANTON_APP_PROVIDER_PARTY_ID = app-canquest::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
CANTON_LOCK_HOLDER_PARTY     = (unset, fallback validator)
LEDGER_API_ADMIN_USER        = fc334391-0f6a-456f-bb95-098b269e62b6
```

---

## 7. INFRASTRUKTUR

```
VPS 1: Canton participant node (ledger + validator)
  - ledger.canquestlabs.com (JSON Ledger API :7575)
  - validator.canquestlabs.com (Splice validator app)
  - Node version: Splice 0.6.12 / Canton SDK 3.4.11
  - DAR ter-deploy: 125 packages (termasuk canquest-v22 + canquest-v23)

VPS 2: Dapp backend (/var/www/canquest)
  - NestJS API (pm2 process: canquest-api)
  - apps/api/.env (config party, Keycloak, dll)
  - Deploy via: git pull origin master && npm run build && pm2 restart

Auth: Keycloak (auth.canquestlabs.com), realm=canton, client=validator-app-backend
DB: Supabase (Postgres)
Frontend: Vercel (Next.js)
Swap: OneSwap DEX (api.oneswap.cc)
```

---

## 8. CARPA MEMULAI CHAT BARU

Paste ini di awal chat baru:

```
Saya melanjutkan pekerjaan DAML v23 + backend atomic Settle refactor.
Detail lengkap ada di file HANDOFF_DAML_V23.md di root repo.

Singkatnya: DAML v23 sudah live di participant node, backend sudah di-refactor
(settleAtomic + 4 claim method atomic path), tapi Settle choice gagal saat
test real dengan error "Missing non-optional fields: Set(context, meta)".
Fix terakhir (commit d060b9a, safeContext helper) BELUM di-deploy ke VPS 2.

Tolong baca HANDOFF_DAML_V23.md utk konteks lengkap, lalu bantu saya:
1. Deploy fix ke VPS 2 + test Settle real
2. Kalau masih gagal, debug error baru
3. Setelah Settle jalan, fix validasi minimum reward CC (bisa 0.1 CC)

Branch master, commit terakhir d060b9a.
```
