# One-Step Toggle (TransferPreapproval) — Audit Inventaris

**READ-ONLY AUDIT** — Tidak ada perubahan kode.

**Konteks:** Transfer masuk = `kind=direct` kalau PENERIMA punya `TransferPreapproval`, `kind=offer` kalau tidak.  
**Target:** Toggle One-Step per user — ON = preapproval ada (transfer masuk direct), OFF = tidak ada (offer pending, user accept/reject manual).

---

## 1. SEMUA Titik AUTO-ACCEPT (Backend Menerima Offer Atas Nama Penerima)

Backend **OTOMATIS** menerima offer/instruction atas nama penerima di lokasi berikut:

| File:Baris | Konteks | Accept Atas Nama Party Siapa |
|------------|---------|------------------------------|
| **apps/api/src/quests/quests.service.ts:1795** | `claimFcfsReward()` — reward step 2 (CIP-0056 offer) | `cantonPartyId` (user claimer) |
| **apps/api/src/quests/quests.service.ts:2073** | `claimDrawCcReward()` — reward raffle (Splice REST offer) | `username` (user winner) |
| **apps/api/src/quests/quests.service.ts:2625** | `claimCcAndCodeRaffleReward()` — CC+Code raffle (Splice REST offer) | `username` (user winner) |
| **apps/api/src/party/party.controller.ts:~580** | `sendCc()` — CIP-0056 offer (isInternalUser=true) | `recipientPartyId` (internal user penerima) |
| **apps/api/src/party/party.controller.ts:~650** | `sendCc()` — Splice REST offer (isInternalUser=true) | `recipientUsername` (internal user penerima) |
| **apps/api/src/party/party.controller.ts:~750** | `collectPlatformFee()` — fee offer (treasury) | `feeParty` (treasury/validator party) |
| **apps/api/src/queue/spin-job.processor.ts:~120** | `processSpinCcReward()` — spin prize (Splice REST offer) | `username` (user spin winner) |
| **apps/api/src/queue/ledger-job.processor.ts:~180** | `processCcReward()` — queued reward (CIP-0056 offer) | `userPartyId` (user penerima) |
| **apps/api/src/queue/ledger-job.processor.ts:~220** | `processCcReward()` — queued reward (Splice REST offer) | `username` (user penerima) |
| **apps/api/src/admin/admin.service.ts:~450** | `distributeRewardsBulk()` — admin bulk send (Splice REST offer) | `username` (user penerima) |

### Catatan Penting

- **`acceptOfferInbox()`** di `party.controller.ts` adalah **MANUAL accept** oleh user (dipanggil dari UI) — **SAH, jangan diganggu**.
- **Semua auto-accept di atas** melanggar prinsip toggle One-Step OFF (user harus accept manual).
- **Untuk toggle One-Step OFF:** Backend **TIDAK boleh** auto-accept. Offer harus tetap pending sampai user accept manual via `acceptOfferInbox()`.

---

## 2. PREAPPROVAL Lifecycle

### 2.1. Di Mana TransferPreapproval Dibuat / Dicek / Diarsip

| Operasi | File | Method | Mekanisme Auth |
|---------|------|--------|----------------|
| **Cek ada/tidak** | `splice-validator.service.ts` | `hasTransferPreapproval(partyId)` | Splice Wallet API (HS256 JWT) |
| **Get detail** | `splice-validator.service.ts` | `getTransferPreapproval(partyId)` | Splice Wallet API (HS256 JWT) |
| **Buat baru** | `splice-validator.service.ts` | `createTransferPreapproval(username)` | Splice Wallet API (HS256 JWT, `sub=username`) |
| **Arsip/cancel** | `splice-validator.service.ts` | `cancelTransferPreapproval(partyId)` | Splice Admin API (HS256 JWT, `sub=admin`) → fallback Ledger API (Keycloak client_credentials) |
| **Cek akses wallet** | `splice-validator.service.ts` | `canAccessWalletAs(username)` | Splice Wallet API (HS256 JWT, `sub=username`) |
| **Ensure preapproval** | `party.controller.ts` | `ensurePreapproval()` | Memanggil `createTransferPreapproval()` (HS256) |

### 2.2. Apakah Onboarding SAAT INI Membuat Preapproval untuk User Baru?

**YA** — di `party.controller.ts` method `setUsername()` (line ~200-250):

```typescript
// TransferPreapproval (dipertahankan dari flow lama)
let preapprovalActive = false;
const existingPreapproval = await this.splice.hasTransferPreapproval(cantonPartyId);
if (existingPreapproval) {
  preapprovalActive = true;
} else {
  preapprovalActive = (await this.splice.createTransferPreapproval(username)).ok;
}
```

**Mekanisme:** Splice Wallet API (HS256 JWT, `sub=username`).

**Problem di Keycloak Mode:**
- Splice API menolak HS256 JWT → `createTransferPreapproval()` **GAGAL** (401 Unauthorized).
- User baru **TIDAK punya** preapproval → transfer masuk jadi `kind=offer` (bukan `direct`).
- Ini sebabnya user `verify` tidak punya preapproval → reward FCFS jadi offer (bukan direct).

### 2.3. Fallback Ledger API untuk Cancel Preapproval

**File:** `canton-ledger.service.ts` method `cancelTransferPreapprovalViaLedger(partyId)`

**Mekanisme:**
1. Query ACS (Active Contract Set) via Ledger API untuk cari `TransferPreapproval` contract milik `partyId`.
2. Exercise choice `TransferPreapproval_Cancel` via Ledger API (Keycloak client_credentials).
3. Auth: **Keycloak client_credentials** (operator) — **BUKAN HS256**.

**Kapan dipakai:** Saat Splice Admin API return 401 (Keycloak mode).

---

## 3. STATE Toggle One-Step

### 3.1. Apakah Ada Field DB / Setting "one-step" Per User?

**TIDAK ADA** field DB untuk toggle One-Step.

**Pemeriksaan:**
- `apps/api/prisma/schema.prisma` model `User` (line 15-63) — **TIDAK ada** field `oneStepEnabled`, `preapprovalEnabled`, atau sejenisnya.
- Status One-Step **murni diturunkan** dari ada/tidaknya `TransferPreapproval` di ledger (on-chain state).

### 3.2. Bagaimana Status One-Step Ditentukan?

**Saat ini:**
- `hasTransferPreapproval(partyId)` → `true` = One-Step ON (transfer masuk direct).
- `hasTransferPreapproval(partyId)` → `false` = One-Step OFF (transfer masuk offer).

**Endpoint toggle:**
- **Enable:** `POST /party/preapproval/enable` → `createTransferPreapproval(username)` (HS256).
- **Disable:** `POST /party/preapproval/disable` → `cancelTransferPreapproval(partyId)` (Admin API → fallback Ledger API).

**Problem:**
- Enable pakai HS256 → **GAGAL** di Keycloak mode.
- Disable pakai Admin API (HS256) → fallback Ledger API (Keycloak) → **BISA JALAN**.

---

## 4. PENCATATAN Reward/Transfer di DB

### 4.1. Di Mana Reward/Transfer Dicatat Sebagai "Diterima"?

**Method:** `users.service.ts` → `recordTransaction(params)`

**Dipanggil di:**

| File | Konteks | Kapan Dicatat |
|------|---------|---------------|
| **quests.service.ts** | `claimFcfsReward()` — reward step 2 | **SETELAH** `acceptTransferInstruction()` sukses (line ~1808) |
| **quests.service.ts** | `claimDrawCcReward()` — reward raffle | **SETELAH** `acceptOfferViaWallet()` sukses (line ~2090) |
| **quests.service.ts** | `claimCcAndCodeRaffleReward()` — CC+Code raffle | **SETELAH** `acceptOfferViaWallet()` sukses (line ~2640) |
| **party.controller.ts** | `sendCc()` — sender (outgoing) | **SETELAH** transfer/offer dibuat (line ~620) |
| **party.controller.ts** | `sendCc()` — receiver (incoming, isInternalUser) | **SETELAH** `acceptTransferInstruction()` / `acceptOfferViaWallet()` sukses (line ~650) |
| **party.controller.ts** | `sendCc()` — sender (offer_only mode) | **LANGSUNG** setelah offer dibuat, **SEBELUM** receiver accept (line ~700) |
| **spin-job.processor.ts** | `processSpinCcReward()` — spin prize | **SETELAH** `acceptOfferViaWallet()` sukses (line ~130) |
| **ledger-job.processor.ts** | `processCcReward()` — queued reward | **SETELAH** `acceptTransferInstruction()` / `acceptOfferViaWallet()` sukses (line ~200) |
| **admin.service.ts** | `distributeRewardsBulk()` — admin bulk send | **SETELAH** `acceptOfferViaWallet()` sukses (line ~460) |

### 4.2. Problem untuk Toggle One-Step OFF

**Saat ini:**
- Reward/transfer dicatat **SETELAH** backend auto-accept sukses.
- Kalau toggle One-Step OFF (offer pending, user belum accept), reward **TIDAK dicatat** di DB.
- User tidak tahu ada reward pending sampai mereka buka inbox offer.

**Solusi yang Dibutuhkan:**
- Saat offer dibuat (tapi belum di-accept), catat transaksi dengan status **PENDING** di DB.
- Saat user accept manual via `acceptOfferInbox()`, update status jadi **COMPLETED**.
- Tambah field `status` di `CcTransaction` model (e.g., `PENDING`, `COMPLETED`, `REJECTED`).

---

## Summary Temuan

### 1. Auto-Accept (10 lokasi)
- **10 titik** backend auto-accept offer atas nama penerima.
- **Melanggar** prinsip toggle One-Step OFF (user harus accept manual).
- **Fix:** Cek `hasTransferPreapproval(receiverPartyId)` sebelum auto-accept. Kalau `false`, **JANGAN** auto-accept.

### 2. Preapproval Lifecycle
- **Onboarding:** `setUsername()` membuat preapproval via HS256 → **GAGAL** di Keycloak mode.
- **Enable:** `createTransferPreapproval()` via HS256 → **GAGAL** di Keycloak mode.
- **Disable:** `cancelTransferPreapproval()` via Admin API (HS256) → fallback Ledger API (Keycloak) → **BISA JALAN**.
- **Fix:** Migrasi `createTransferPreapproval()` ke Ledger API (Keycloak client_credentials).

### 3. State Toggle
- **TIDAK ada** field DB untuk toggle One-Step.
- Status One-Step **murni diturunkan** dari `hasTransferPreapproval(partyId)` (on-chain state).
- **Rekomendasi:** Tambah field DB `oneStepEnabled: Boolean` untuk cache status (optional, untuk performa).

### 4. Pencatatan Reward/Transfer
- Reward dicatat **SETELAH** backend auto-accept sukses.
- Kalau toggle One-Step OFF (offer pending), reward **TIDAK dicatat** di DB.
- **Fix:** Tambah field `status` di `CcTransaction` model (`PENDING`, `COMPLETED`, `REJECTED`). Catat offer sebagai `PENDING`, update jadi `COMPLETED` saat user accept manual.

---

## Next Steps (Manual)

1. **Review** inventaris ini line-by-line.
2. **Prioritas P1:** Migrasi `createTransferPreapproval()` ke Ledger API (Keycloak mode).
3. **Prioritas P2:** Tambah field `status` di `CcTransaction` model untuk offer pending.
4. **Prioritas P3:** Update 10 titik auto-accept untuk cek `hasTransferPreapproval()` sebelum accept.
5. **Test:** Toggle One-Step ON/OFF → verifikasi transfer masuk direct vs offer pending.
