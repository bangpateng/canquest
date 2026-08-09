# HANDOFF — DAML v28 (Settle Rollback + Wallet/Eligibility Improvement)

> **Tanggal:** 2026-08-10
> **Status:** DAML v28 applied (`Main.daml` + `daml.yaml`), **BELUM build DAR**, **BELUM upload**
> **Predecessor:** v27 (commit `659dde1`) — AppPaymentRequest reward flow
> **Tujuan doc ini:** Konteks lengkap utk chat baru, supaya tidak keluar jalur.

---

## 📋 CARA PAKAI DOC INI DI CHAT BARU

Copy-paste prompt ini di awal chat baru:

```
Saya melanjutkan DAML v28 (rollback reward flow ke Settle + improvement wallet).
Detail lengkap ada di HANDOFF_DAML_V28.md (root repo) — status + break list + next step.

Singkatnya: DAML v28 sudah applied ke packages/daml/daml/Main.daml + daml.yaml.
BELUM build DAR, BELUM upload. Backend masih jalan v25 Settle flow (KOMAPTIBEL
mayoritas v28). Yang break: WalletRegistration field (username/inviteCode →
userProfileRef) + WalletRegistrationProposal flow baru.

Tolong baca HANDOFF_DAML_V28.md utk konteks lengkap, lalu bantu saya
kerjakan next step (build DAR di VPS → fix backend WalletRegistration
→ upload DAR → test).

Branch master. Check git log utk HEAD terbaru.
```

---

## 🎯 KENAPA v28? (Rollback v27)

### v27 (commit kemarin 2026-08-09, `659dde1`)
Mengganti reward flow dari `Settle` (multi-controller, nested TransferFactory)
ke `AppPaymentRequest` (Splice DAR template). Alasan v27: preapproval fragile
di multi-user; AppPaymentRequest = explicit user consent.

**Masalah v27:** Backend Fase 2 rewrite **belum dikerjakan**. Backend yang jalan
sekarang masih **v25 Settle flow** (`quest-ledger.service.ts`: settleAtomic,
recordTxId, QuestClaimReceipt). DAR v27 juga **belum di-upload** ke validator.

### v28 (sekarang) — ROLLBACK + IMPROVEMENT
Rollback reward flow ke Settle (pola v25 yang sudah verified jalan) +
terapkan 3 improvement dari playbook:
1. **WalletRegistrationProposal** (NEW template) — 2-step consent: admin
   propose → user Accept.
2. **userProfileRef** — PII (username, inviteCode) dipindah off-chain,
   on-ledger hanya reference Text.
3. **CampaignEligibility non-consuming** — revoke/expire create baru status
   REVOKED/EXPIRED (audit trail), bukan archive.

**Rasional:** v27 belum bisa deploy (Fase 2 backend stuck). v28 = Settle
pattern (sudah jalan) + improvement bagus dari playbook. Path paling realistis
utk production dalam waktu dekat.

---

## 📊 STATUS SAAT INI

| Komponen | Status | Catatan |
|---|---|---|
| **DAML v28 contract** | ✅ Applied | `packages/daml/daml/Main.daml` + `daml.yaml` |
| **DAR v28** | ❌ Belum build | Build di VPS (`daml build`). 4 DAR data-dep harus di-fetch dulu (`scripts/fetch-daml-deps.sh`) |
| **DAR v28 uploaded?** | ❌ Belum | JANGAN upload sebelum backend fix selesai |
| **Backend v28** | ⚠️ Partially compatible | Settle flow OK; WalletRegistration BREAK |
| **v25 Settle (yg jalan)** | ✅ MASIH JALAN | Jangan deploy v28 DAR sampai backend fix selesai |
| **v27 DAR uploaded?** | ❌ Tidak pernah | v27 DAR compiled di VPS tapi tidak di-upload (Fase 2 stuck) |

---

## 🏗️ ARSITEKTUR v28

### 6 template (`packages/daml/daml/Main.daml`):

1. **WalletRegistrationProposal** (NEW) — admin propose, user Accept
   - Choice `Accept` (controller userAddress) → create WalletRegistration
   - signatory admin, observer userAddress
2. **WalletRegistration** — identitas on-chain
   - Field: `admin, userAddress, userProfileRef, partyId, registeredAt`
   - signatory admin, userAddress (co-signed hasil Accept proposal)
   - TIDAK ADA CHOICE (immutable)
3. **CampaignEligibility** — LOCK_CC/POINTS proof
   - Field sama + `status` jadi "ELIGIBLE"|"REVOKED"|"EXPIRED"
   - `RevokeEligibility` + `ExpireEligibility` → **non-consuming** (create baru)
4. **QuestCampaign** — kuota FCFS/Raffle + state machine
   - `ClaimSlot` / `DrawWinner` return **tuple** `(Campaign, Receipt)` + param `rewardSender`
   - State machine: DRAFT→ACTIVE→PAUSED→ENDED→CLOSED
5. **QuestClaimReceipt** (KEMBALI dari v27 deletion) — receipt + atomic Settle
   - `Settle` multi-controller `[admin, userAddress, rewardSender]`
   - 3 leg atomic: fee (wajib) + reward (optional) + FAR marker (optional)
   - `RecordTxId` / `RevealCode` / `Expire` choices
6. **PlatformTransfer** — send token + fee atomic (sama v25/v27)
   - `ExecuteTransfer` multi-controller `[admin, userAddress]`

### YANG DIHAPUS dari v27:
- `QuestPaymentRequest` template (wrapper AppPaymentRequest)
- Pemikiran AppPaymentRequest flow (Accept/Collect) — kembali ke Settle

### YANG DITAMBAH vs v25 (improvement):
- `WalletRegistrationProposal` template baru
- `WalletRegistration.userProfileRef` (ganti username/inviteCode)
- `CampaignEligibility` revoke/expire non-consuming

---

## ⚠️ BREAK LIST — Backend yang HARUS di-fix sebelum upload DAR v28

### 🔴 BREAK 1: `registerWallet()` — `quest-ledger.service.ts:379-437`

```typescript
// SEKARANG (v25, kirim username + inviteCode):
const res = await this.ledger.createContract(
  tpl,
  {
    admin: operator,
    userAddress: params.userPartyId,
    username: params.username,        // ❌ HAPUS
    partyId: params.partyId,
    inviteCode: params.inviteCode,    // ❌ HAPUS
    registeredAt: new Date().toISOString(),
  },
  [operator],
  ...
);
```

v28 butuh:
```typescript
{
  admin: operator,
  userAddress: params.userPartyId,
  userProfileRef: params.userProfileRef,  // ✅ reference ke profile off-chain (DB)
  partyId: params.partyId,
  registeredAt: new Date().toISOString(),
}
```

**Tapi WAIT** — v28 juga punya `WalletRegistrationProposal` 2-step.
Backend harus pilih strategi (lihat NEXT STEP, keputusan user).

### 🔴 BREAK 2: `recordPartyRegistration()` — `quest-ledger.service.ts:1402-1420`

Wrapper yang panggil registerWallet. Signature lewat `username`/`inviteCode`.
Harus ubah jadi `userProfileRef` (atau generate reference dari DB user id).

### 🟢 OK: ClaimSlot/DrawWinner/Settle/RecordTxId/RevealCode flow
Backend v25 Settle flow (`quest-ledger.service.ts:623-980`) **kompatibel** v28:
- ClaimSlot/DrawWinner menerima `rewardSender` param ✅
- Return tuple `(Campaign, Receipt)` ✅ (backend sudah handle via `extractContractIdsByTemplate`)
- Settle multi-controller `[admin, userAddress, rewardSender]` ✅
- RecordTxId/RevealCode ✅

### 🟢 OK: PlatformTransfer
Sama persis v25/v27. Backend `executePlatformTransfer` jalan.

### 🟡 NEW: WalletRegistrationProposal flow (belum ada backend)
Mau 2-step (Proposal → Accept) atau tetap 1-step (create WalletRegistration
langsung)? Lihat NEXT STEP.

---

## 🎯 NEXT STEP (urutan prioritas)

### Step 1: Build DAR v28 di VPS
```bash
# Di VPS, pull master
cd /var/www/canquest && git pull

# Fetch 4 DAR data-dep (jika belum ada)
bash scripts/fetch-daml-deps.sh

# Build DAR v28
cd packages/daml
~/.daml/bin/daml build
# Output: .daml/dist/canquest-v28-1.0.0.dar

# Inspect package ID
~/.daml/bin/damlc inspect-dar --json .daml/dist/canquest-v28-1.0.0.dar | jq '.main_package_id'
```

**JANGAN upload dulu** sampai backend fix selesai.

### Step 2: Fix backend WalletRegistration
Pilih strategi (lihat ⚠️ DECISION di bawah):

**Opsi A (minimal, tetap 1-step):** Ubah `registerWallet()` payload:
- Hapus `username`, `inviteCode` dari params + payload
- Tambah `userProfileRef` (bisa: `user:${userId}` atau UUID dari DB)
- Backend tetap create WalletRegistration langsung (skip Proposal)
- Proposal template tetap di DARL tapi belum dipakai (dormant)

**Opsi B (full 2-step):** Implement WalletRegistrationProposal flow:
- `createWalletRegistrationProposal(actAs: [admin])`
- User exercise `Accept` (actAs: [userAddress]) — via frontend atau custodial backend
- Lebih clean tapi butuh lebih banyak wiring

### Step 3: Update `recordPartyRegistration()` caller
Sesuaikan signature dengan opsi yang dipilih.

### Step 4: Build + test backend lokal
```bash
cd apps/api && npm run build
```

### Step 5: Upload DAR v28 ke validator
```bash
cd apps/api && node scripts/upload-daml-dar.cjs
# Atau via curl: lihat playbook v28 Bagian 2 step 3-5
```

### Step 6: Update env + restart API
```bash
# .env: update DAML_PACKAGE_ID ke package ID v28 baru
pm2 restart canquest-api
```

### Step 7: Test matrix (sama v25 RUNBOOK_DAML_V25_DEPLOY.md)
- ✅ WalletRegistration create (dengan userProfileRef baru)
- ✅ ClaimSlot FCFS
- ✅ Settle atomic (fee + reward)
- ✅ RecordTxId
- ✅ PlatformTransfer.ExecuteTransfer

---

## ⚠️ DECISION YANG PERLU USER PUTUSKAN

### 1. WalletRegistration: 1-step atau 2-step?

| Opsi | Effort | User consent | Notes |
|---|---|---|---|
| **A (1-step, skip Proposal)** | Rendah | Implisit (admin create langsung) | Proposal template dormant di DAR |
| **B (2-step, pakai Proposal)** | Sedang | Eksplisit (user Accept) | Sesuai playbook v28 design |

### 2. userProfileRef format?
- `user:${dbUserId}` (reference ke Prisma User.id)?
- UUID terpisah?
- URL ke profile (mis. `https://api.canquestlabs.com/users/${id}`)?

### 3. CampaignEligibility revoke/expire?
Backend sekarang belum panggil (consumed by ledger auto-archive di v25).
v28 non-consuming → backend bisa query history REVOKED/EXPIRED.
Mau langsung implement scheduler revoke/expire, atau dormant dulu?

---

## 📐 CATATAN TEKNIS PENTING

### Optional encoding di Settle (DAML-LF JSON)
Backend `quest-ledger.service.ts:881-920` sudah handle Optional encoding benar:
- `Some x` → raw value (null wrapper)
- `None` → null
- Pattern: `const opt = <T,>(v: T | null) => (v == null ? null : v);`

**JANGAN ulangi bug history:**
- `{tags:'Some',value:x}` → salah
- `{tag:'Some',value:x}` → salah
- `{tag:'None',value:{}}` → salah (None harus null)

### Settle actAs backend (WAJIB lengkap)
```typescript
const actAs = [operator, params.userPartyId];
if (hasReward) actAs.push(params.rewardSenderPartyId);
if (params.featuredAppRightCid && params.appProviderPartyId) {
  actAs.push(params.appProviderPartyId);
}
```
- 3 controller di DAML: `admin, userAddress, rewardSender`
- Ke-4 (`appProvider`) bila FAR on (Leg 3 marker)
- **JANGAN miss rewardSender** — Settle akan reject krn missing controller

### Consuming choices — JANGAN retry setelah fail
ClaimSlot/DrawWinner/Settle consuming → setelah fail, contractId lama sudah
invalid. **Selalu fetch active contract terbaru** sebelum retry.

### Timestamp format
DAML pakai `Text` (ISO 8601). Backend harus format konsisten:
`YYYY-MM-DDTHH:mm:ssZ` (UTC, Z suffix). String comparison di on-ledger
guard (`e.lockedAt > e.campaignCreatedAt`) butuh format konsisten.

---

## 📦 DOKUMENTASI PENDUKUNG di repo

| File | Isi |
|---|---|
| `docs/RUNBOOK_DAML_V25_DEPLOY.md` | Deploy v25 + 10 test matrix (basis v28) |
| `docs/RUNBOOK_ATOMIC_SETTLE.md` | Diagnosa atomic Settle (debug history) |
| `docs/RUNBOOK_GRANT_ANY_PARTY_RIGHTS.md` | Grant CanActAs rights |
| `docs/WALLET_USER_PROXY_SETUP.md` | Party list + config |
| `docs/V27_MASTER_FLOW_REFERENCE.md` | Flow v27 (history, utk konteks) |
| `HANDOFF_DAML_V27.md` | Konteks v27 (history) |
| `PROMPT_CANTON_ATOMIC_FEE.md` | Prompt atomic fee pattern |

---

## 🗒️ DEV NOTES — Yang saya temukan saat apply v28

### Inkonsistensi di playbook v28 (yang user paste)
Playbook v28 sebenarnya punya beberapa inkonsistensi vs v27 yang ada:
1. `QuestCampaign.Close` choice hapus `assertMsg closedAt /= ""` (padahal field
   tetap diambil). Saya tambahin assertion di v28 contract (lebih safe).
2. `CampaignEligibility` jadi non-consuming (create baru REVOKED/EXPIRED) —
   ini BERBEDA dari v25 (consuming) dan v27 (consuming). Backend yang sekarang
   belum panggil, jadi tidak break.
3. `Pause`/`EndCampaign` hapus `assertMsg updatedAt /= ""` (v27 punya). Saya
   ikuti v28 playbook (hapus) kecuali `Activate` (tetap ada utk safety).

### Header daml.yaml v27 (sudah saya bersihkan di v28)
Header komentar daml.yaml v27 masih bilang "v23" (stale dari versi lama).
Saya refresh ke v28 di daml.yaml baru.

### DAR data-dep tidak ada di repo
`packages/daml/dars/` hanya punya 2 file lama (`splice-amulet-current.dar`,
`splice-wallet-0.1.9.dar`). 4 DAR yang `daml.yaml` rujuk tidak ada —
harus fetch via `scripts/fetch-daml-deps.sh` (di VPS). Ini pre-existing,
bukan masalah v28.

### Frontend daml-types stale
`packages/frontend/src/daml-types/canquest/` masih v11 (sangat lama).
Tidak ada tipe v27/v28. Frontend tidak break, tapi perlu regen tipe setelah
DAR v28 ready (via `daml codegen`).

### Build lokal tidak bisa di Windows ini
DAML SDK tidak ter-install lokal; docker image di `package.json` script
`daml:build` ada tapi DAR data-dep tidak ada. Build harus di VPS (sesuai
workflow yang sudah ada). Saya tidak paksa build lokal.
