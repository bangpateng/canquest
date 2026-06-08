# 🔍 CanQuest DAML Contract Audit — Mainnet Readiness Report

> **Tanggal Audit:** 8 Juni 2026  
> **Auditor:** AI Agent (Cline)  
> **Package:** `canquest-v6` | SDK: 3.4.11  
> **Referensi:** Canton Network M3/M4 Docs — https://docs.canton.network/appdev/

---

## Executive Summary

**Overall Status: ⚠️ BELUM SIAP UNTUK MAINNET** — Ada 3 critical bugs dan 2 high-risk issues yang HARUS di-fix sebelum deploy ke Canton Mainnet. Ekosistem kontrak sudah baik secara design pattern (admin-signatory, observer-user, best-effort ledger writes), tetapi ada type mismatch serius yang menyebabkan kontrak tidak akan bisa dibuat di ledger.

---

## 🔴 CRITICAL BUGS (Harus Di-fix Sebelum Mainnet)

### BUG-1: Type Mismatch `maxWinners` & `currentClaims` — QuestCampaign TIDAK BISA DIBUAT

**Lokasi:** `apps/api/src/canton/quest-ledger.service.ts` line 561-568

**Masalah:** Backend mengirim `maxWinners` dan `currentClaims` sebagai **string** ke Canton JSON API v2, tetapi DAML contract mendefinisikan kedua field sebagai **Int**.

**DAML Contract (Main.daml line 126-127):**
```daml
maxWinners    : Int
currentClaims : Int
```

**Backend (quest-ledger.service.ts line 567-568):**
```typescript
maxWinners:    String(params.maxWinners),    // ❌ String dikirim ke field Int
currentClaims: String(0),                     // ❌ String dikirim ke field Int
```

**Dampak:** Canton JSON API v2 akan **menolak** setiap `createContract` untuk `QuestCampaign`. Admin tidak akan bisa membuat campaign baru di mainnet.

**Fix:**
```typescript
maxWinners:    params.maxWinners,    // ✅ Kirim sebagai number
currentClaims: 0,                    // ✅ Kirim sebagai number
```

---

### BUG-2: Package Name Inconsistency — `canquest-v6` vs `canquest-v3` vs `canquest-v4`

**Lokasi:** Multiple files

| File | Package Name |
|------|-------------|
| `packages/daml/daml.yaml` (line 24) | `canquest-v6` |
| `docs/MAINNET_MIGRATION_GUIDE.md` (line 179) | `canquest-v3` ❌ |
| `docs/DAML_CONTRACTS_DOCUMENTATION.md` (judul) | `canquest-v4` ❌ |
| `Main.daml` comment (line 3) | `canquest-v4` ❌ |
| `quest-ledger.service.ts` (line 7, 142) default | `canquest-v6` ✅ |

**Dampak:** 
- Mainnet Migration Guide masih mereferensi `canquest-v3` yang sudah obsolete (v3 tidak punya QuestCampaign, QuestClaim, WalletRegistration, DailyCheckIn, ReferralReward, CcTransactionLog)
- Developer yang mengikuti guide akan menggunakan konfigurasi yang salah
- DAR yang ter-build bernama `canquest-v6-3.0.0.dar`, tapi migration guide menyebut `canquest-v4-1.0.0.dar`

**Fix:**
1. Update `docs/MAINNET_MIGRATION_GUIDE.md` line 179: `CANTON_DAML_PACKAGE_NAME=canquest-v6`
2. Update comment di `Main.daml` line 3: `canquest-v6`
3. Update `docs/DAML_CONTRACTS_DOCUMENTATION.md` judul: `canquest-v6`
4. Update `docs/DAML_DEPLOY_VPS.md` jika ada — sebut `canquest-v6`

---

### BUG-3: `ConfirmWalletActive` Overwrites `registeredAt` — Semantic Error

**Lokasi:** `packages/daml/daml/Main.daml` lines 105-111

**Masalah:** Choice `ConfirmWalletActive` menerima `confirmedAt` tetapi menggunakannya untuk **overwrite** field `registeredAt`, bukan menyimpannya di field terpisah.

```daml
choice ConfirmWalletActive : ContractId WalletRegistration
  with
    confirmedAt : Text
  controller admin
  do
    assertMsg "confirmedAt tidak boleh kosong!" (confirmedAt /= "")
    create this with registeredAt = confirmedAt  -- ❌ Overwrites registeredAt!
```

**Dampak:** Setelah `ConfirmWalletActive` dipanggil, timestamp registrasi asli hilang. Ini masalah audit trail — kapan wallet pertama kali didaftarkan menjadi tidak terlacak.

**Fix:**
Tambahkan field `confirmedAt` di template `WalletRegistration`:
```daml
template WalletRegistration
  with
    admin        : Party
    userAddress  : Party
    username     : Text
    partyId      : Text
    inviteCode   : Text
    registeredAt : Text
    confirmedAt  : Text    -- ✅ Field baru
  where
    signatory admin
    observer userAddress

    choice ConfirmWalletActive : ContractId WalletRegistration
      with
        confirmedAt : Text
      controller admin
      do
        assertMsg "confirmedAt tidak boleh kosong!" (confirmedAt /= "")
        create this with confirmedAt = confirmedAt  -- ✅ Update field yang benar
```

**⚠️ DAMPAK MIGRASI:** Perubahan ini memerlukan DAR build ulang dan upload ulang ke ledger. Semua `WalletRegistration` contract yang sudah ada harus di-archive dan dibuat ulang dengan schema baru.

---

## 🟠 HIGH-RISK ISSUES

### ISSUE-4: `spinCost` dan `rewardPoints` Harusnya `Int`, Bukan `Text`

**Lokasi:** `packages/daml/daml/Main.daml` lines 312-313

**Masalah:** Field `spinCost` dan `rewardPoints` di template `SpinExecution` menggunakan tipe `Text`, padahal keduanya adalah nilai numerik.

```daml
rewardPoints  : Text     -- ❌ Seharusnya Int
spinCost      : Text     -- ❌ Seharusnya Int
```

**Dampak:**
- Tidak ada validasi tipe numerik di DAML level (bisa menerima string apapun)
- Tidak bisa dilakukan operasi aritmatika on-chain
- Tidak sesuai dengan DAML best practices (gunakan tipe yang tepat)

**Fix:**
```daml
rewardPoints  : Int      -- ✅ Tipe numerik
spinCost      : Int      -- ✅ Tipe numerik
```

Dan di backend (`quest-ledger.service.ts` lines 901-904):
```typescript
rewardPoints:  params.rewardPoints,     // ✅ Kirim sebagai Int
spinCost:      params.spinCost,          // ✅ Kirim sebagai Int
```

**⚠️ DAMPAK MIGRASI:** Perlu DAR build ulang.

---

### ISSUE-5: Mainnet Auth — HS256 Tidak Aman untuk Mainnet

**Lokasi:** `apps/api/src/canton/canton-ledger.service.ts` line 64-70

**Masalah:** Canton Ledger Service menggunakan JWT dengan algoritma **HS256** (shared secret). Canton Mainnet menggunakan **asymmetric JWT (RS256/ES256)** — HS256 tidak cukup aman untuk mainnet environment.

```typescript
private ledgerToken(actingUser?: string): string | null {
  if (!this.secret) return null;
  return jwt.sign(
    { sub, aud: this.ledgerAudience },
    this.secret,
    { algorithm: 'HS256', expiresIn: '5m' },  // ❌ HS256 untuk mainnet
  );
}
```

**Referensi Canton Docs:** Mainnet memerlukan asymmetric key pairs. Operator harus meng-upload public key ke Canton Network saat onboarding.

**Fix:**
1. Generate RSA atau ECDSA key pair
2. Update code untuk support RS256/ES256:
```typescript
private ledgerToken(actingUser?: string): string | null {
  const privateKey = this.config.get<string>('CANTON_JWT_PRIVATE_KEY');
  if (!privateKey) return null;
  return jwt.sign(
    { sub, aud: this.ledgerAudience },
    privateKey,
    { algorithm: 'RS256', expiresIn: '5m' },
  );
}
```
3. Tambahkan env vars:
```env
CANTON_JWT_PRIVATE_KEY=/etc/canton/jwt-private.pem
CANTON_JWT_PUBLIC_KEY=/etc/canton/jwt-public.pem
```

---

## 🟡 MEDIUM ISSUES

### ISSUE-6: QuestCampaign Tidak Memiliki `observer user`

**Lokasi:** `Main.daml` lines 118-207

**Masalah:** `QuestCampaign` hanya memiliki `signatory admin` tanpa `observer`. Semua template lain (UserAccount, WalletRegistration, QuestClaim, DailyCheckIn, SpinExecution, ReferralReward, CcTransactionLog) memiliki `observer userAddress`.

**Dampak:** User tidak bisa melihat QuestCampaign contract dari Canton ledger via JSON API. Ini mengurangi transparansi on-chain.

**Fix:**
Tambahkan field `observerUser` atau ubah desain agar campaign punya observer. Atau tambahkan penjelasan di docs bahwa ini by design karena campaign hanya relevan untuk admin.

---

### ISSUE-7: `QuestCampaign` Choices Tidak Dipanggil dari Admin Panel

**Lokasi:** `Main.daml` choices `CloseCampaign` (line 191), `UpdateCampaignStatus` (line 199)

**Masalah:** Backend tidak menyediakan method untuk:
- `CloseCampaign` — menutup campaign via on-chain
- `UpdateCampaignStatus` — update status campaign via on-chain

**Dampak:** Jika admin mengubah status campaign di database, kontrak on-chain tetap `ACTIVE`. Inkonsistensi antara DB state dan ledger state.

**Fix:**
Tambahkan method di `quest-ledger.service.ts`:
```typescript
async closeQuestCampaign(campaignContractId: string): Promise<...>
async updateQuestCampaignStatus(campaignContractId: string, newStatus: string): Promise<...>
```
Dan panggil dari admin controller saat admin menutup/mengupdate campaign.

---

### ISSUE-8: `CC_AND_INVITE` (Auto-Assign) Tidak Punya On-Chain Flow

**Lokasi:** `quest-ledger.service.ts` line 510-511

**Masalah:** Reward type `CC_AND_INVITE` dimapping ke `CC_FCFS` tapi tidak ada flow on-chain khusus. CC dan kode invite diberikan otomatis saat user submit quest.

**Dampak:** Tidak ada on-chain audit trail untuk quest `CC_AND_INVITE`. Kalau user klaim quest ini dan reward dikirim, tidak ada kontrak `QuestClaim` yang mencatatnya.

**Rekomendasi:** Tambahkan `QuestClaim` creation untuk `CC_AND_INVITE` juga, atau minimal catat di `CcTransactionLog`.

---

### ISSUE-9: Multiple Deprecated No-Op Stubs Masih Ada

**Lokasi:** `quest-ledger.service.ts` lines 1015-1243

**Masalah:** Ada 15+ deprecated methods yang semuanya return empty/no-op. Ini technical debt.

**Contoh:**
- `ensureParticipation()` — no-op
- `createClaimSession()` — no-op
- `createEarnClaimSession()` — no-op
- `createFcfsSlotReservation()` — no-op
- `createCcRewardEntitlement()` — no-op
- `createCodeRewardEntitlement()` — no-op
- `recordCcTransfer()` — no-op
- `createRaffleWinner()` — no-op
- `markRewardClaimed()` — no-op
- `recordQuestCompletion()` — no-op
- `recordTaskSubmission()` — no-op (by design, documented)

**Rekomendasi:** Setelah semua caller di-refactor ke method baru, hapus no-op stubs. Jangan deploy ke mainnet dengan dead code.

---

## 🟢 THINGS DONE WELL ✅

1. **Authorization Pattern Solid:** `signatory admin, observer user` — user tidak bisa submit sendiri, semua choice lewat admin controller, sesuai Canton M3 best practices.

2. **Best-Effort Ledger Pattern:** Semua ledger write returns errors tapi tidak throw exception — Canton outage tidak akan break main application flow. ✅

3. **Idempotency Built-in:** Setiap operasi create contract mengecek existing contract dulu via ACS query sebelum membuat baru. Mencegah duplikat kontrak. ✅

4. **Command Deduplication:** Setiap operasi menggunakan stable `commandId` — jika command sama dikirim ulang (retry), ledger returns original result. Mencegah double-spend. ✅

5. **Retry with Backoff (M7 Pattern):** `canton-ledger.service.ts` mengimplementasikan exponential backoff (150ms, 300ms, 600ms) dengan max 3 retries untuk contention errors. ✅

6. **Decimal Serialization:** Method `dec()` di `quest-ledger.service.ts` memastikan Decimal field dikirim sebagai string `"10.0"` sesuai Canton JSON API v2 spec. ✅

7. **Comprehensive Test Suite:** `Test.daml` memiliki 30+ test cases mencakup happy paths, edge cases, dan `submitMustFail` scenarios. ✅

8. **Dokumentasi Internal Lengkap:** `DAML_CONTRACTS_DOCUMENTATION.md` mendokumentasikan semua template, field, choice, dan flow mapping. ✅

9. **QuestKind Mapping Jelas:** `mapRewardTypeToQuestKind()` di backend menangani mapping 8 RewardType → 6 DAML questKind dengan benar. ✅

10. **ACS Query-based Contract Lookup:** Backend menggunakan `queryActiveContracts` dan `findContractId` untuk mencari existing contracts — tidak bergantung pada local cache yang bisa stale. ✅

---

## 📋 Checklist — Yang Harus Dilakukan Sebelum Mainnet Deploy

### Critical (Harus)
- [ ] **BUG-1:** Fix type mismatch `maxWinners` & `currentClaims` di `createQuestCampaign()` — ganti `String(...)` jadi number
- [ ] **BUG-2:** Update `MAINNET_MIGRATION_GUIDE.md` — ganti `canquest-v3` → `canquest-v6`
- [ ] **BUG-3:** Fix `ConfirmWalletActive` — jangan overwrite `registeredAt`, tambahkan field `confirmedAt`
- [ ] **ISSUE-5:** Implementasi asymmetric JWT (RS256/ES256) untuk mainnet auth

### High Priority (Sebaiknya)
- [ ] **ISSUE-4:** Ubah `spinCost` dan `rewardPoints` dari `Text` → `Int` di DAML `SpinExecution`
- [ ] **BUG-2:** Update semua komentar `canquest-v4` → `canquest-v6` di Main.daml, docs, scripts
- [ ] Build ulang DAR: `daml build` → `canquest-v6-3.0.0.dar`
- [ ] Jalankan `daml test` — pastikan semua 30+ test cases PASS
- [ ] Upload DAR baru ke testnet dulu untuk verifikasi
- [ ] Test end-to-end: buat campaign, claim, spin, check-in — verifikasi semua contract terbuat

### Medium Priority (Nice to Have)
- [ ] **ISSUE-6:** Tambahkan `observer` di `QuestCampaign` atau dokumentasikan alasan tidak ada
- [ ] **ISSUE-7:** Tambahkan method `closeQuestCampaign()` dan `updateQuestCampaignStatus()` di backend
- [ ] **ISSUE-8:** Tambahkan on-chain audit trail untuk `CC_AND_INVITE` quest type
- [ ] **ISSUE-9:** Bersihkan deprecated no-op stubs dari `quest-ledger.service.ts`
- [ ] Update `docs/DAML_DEPLOY_VPS.md` dengan package name `canquest-v6`

### Mainnet Migration Specific
- [ ] Perbarui `CANTON_DAML_PACKAGE_NAME=canquest-v6` di `.env` VPS 2
- [ ] Generate asymmetric key pair untuk mainnet JWT auth
- [ ] Upload DAR baru ke Canton mainnet participant (VPS 1)
- [ ] Verifikasi DAR: `node scripts/verify-daml-package.cjs`
- [ ] Update `CANTON_DAML_PACKAGE_ID` dengan hash dari mainnet
- [ ] Test 1 user complete flow di mainnet (register → wallet → quest claim → spin)

---

## 📊 Ringkasan Scoring

| Kategori | Score | Notes |
|----------|-------|-------|
| Design Pattern | 9/10 | Admin-signatory + observer pattern solid, best-effort pattern bagus |
| Type Safety | 5/10 | BUG-1 critical, spinCost/rewardPoints sebagai Text |
| Code Quality | 7/10 | Banyak deprecated stubs, package name inconsistency |
| Test Coverage | 8/10 | 30+ test cases, edge cases covered, `submitMustFail` ada |
| Mainnet Readiness | 5/10 | JWT auth perlu upgrade, 3 critical bugs belum di-fix |
| Documentation | 8/10 | Internal docs bagus, tapi package name tidak konsisten |
| Backend Integration | 8/10 | Mapping lengkap, idempotency, retry, deduplication |
| **Overall** | **6.5/10** | **⚠️ Belum siap mainnet — fix 3 critical bugs dulu** |

---

## 🔧 Panduan Fix untuk Developer

### Step 1: Fix DAML Contract (`packages/daml/daml/Main.daml`)

1. **WalletRegistration:** Tambahkan field `confirmedAt : Text`, ubah choice `ConfirmWalletActive` untuk update `confirmedAt` bukan `registeredAt`
2. **SpinExecution:** Ubah `rewardPoints : Text` → `rewardPoints : Int`, `spinCost : Text` → `spinCost : Int`
3. **QuestCampaign:** Pertimbangkan tambahkan observer
4. Update semua komentar `canquest-v4` → `canquest-v6`

### Step 2: Fix Backend (`apps/api/src/canton/quest-ledger.service.ts`)

1. **`createQuestCampaign()` line 567-568:** Ganti `String(params.maxWinners)` → `params.maxWinners`, `String(0)` → `0`
2. **`registerWallet()`:** Tambahkan `confirmedAt: ''` di create arguments
3. **`recordSpinExecution()` line 901-904:** Ganti `String(params.rewardPoints)` → `params.rewardPoints`, `String(params.spinCost)` → `params.spinCost`

### Step 3: Build & Test

```bash
cd packages/daml
daml build
daml test
```

### Step 4: Update Config & Docs

1. Update `MAINNET_MIGRATION_GUIDE.md` line 179
2. Update `DAML_CONTRACTS_DOCUMENTATION.md` judul dan referensi
3. Update `DAML_DEPLOY_VPS.md`

---

**Kesimpulan:** Ekosistem DAML contract CanQuest sudah didesain dengan baik secara arsitektur — pattern admin-signatory, best-effort writes, idempotency, ACS queries, retry mechanism, dan comprehensive test suite semuanya solid. Namun ada 3 critical bugs (type mismatch, package name inconsistency, wallet timestamp overwrite) dan 1 high-risk auth issue yang HARUS di-fix sebelum deploy ke Canton Mainnet. Setelah fix selesai, jalankan `daml test`, upload DAR baru, dan test end-to-end sebelum go-live.