# HANDOFF — DAML v27 (AppPaymentRequest Architecture Migration)

> **Tanggal:** 2026-08-06
> **HEAD:** `659dde1` (DAML v27 applied, backend belum rewrite)
> **Status:** DAML v27 compiled (DAR built), v25 Settle **MASIH JALAN** (jangan deploy v27 sampai Fase 2 selesai)
> **Tujuan doc ini:** Konteks lengkap utk chat baru, supaya tidak keluar jalur.

---

## 📋 CARA PAKAI DOC INI DI CHAT BARU

Copy-paste prompt ini di awal chat baru:

```
Saya melanjutkan DAML v27 migration (Fase 2 backend rewrite).
Detail lengkap ada di file HANDOFF_DAML_V27.md di root repo.

Singkatnya: DAML v27 sudah applied + compiled (DAR built, commit 659dde1).
Tapi backend belum rewrite — masih pakai v25 Settle yang jalan.
Fase 2 = backend rewrite utk AppPaymentRequest flow (create + accept + collect).

Tolong baca HANDOFF_DAML_V27.md utk konteks lengkap, lalu bantu saya
kerjakan Fase 2 (bertahap, terverifikasi, tidak terburu-buru).

Branch master, HEAD 659dde1.
```

---

## 🛑 KOREKSI PENTING (2026-08-07) — PREMIS v27 ASLI CACAT

> **Baca ini dulu sebelum lanjut.** Doc di bawah section ini adalah versi ASLI
> (pre-correction) yang disimpan utk history. Premis arsitektur v27 1.4.0
> ternyata **salah** — diverifikasi melalui dokumentasi resmi Splice
> (`docs.sync.global`) + analisa codebase mendalam.

### Apa yang salah di premis asli?

Doc asli (bawah) mengasumsikan **satu AppPaymentRequest bawa reward+fee**:
`sender=user, receiverAmounts=[(user, reward), (treasury, fee)]`. Itu **mustahil** —
user tidak bisa kirim reward ke dirinya sendiri.

### Kenapa salah? (verified vs docs Splice)

`AppPaymentRequest` adalah flow **USER-BAYAR** (source: `docs.sync.global`):
- `sender` = "the party that should **pay**"
- `receiverAmounts` = "pairs of (party, amount) requesting to be **paid**"
- `provider` = "the app provider; **receives** usage rewards"

Selain itu, **Splice tidak punya mekanisme native platform→user reward** sama sekali:
- `AppRewardCoupon` dimiliki **provider** (network → app utk usage), bukan app → user.
- `WalletUserProxy` = provider *earn* credit dari aktivitas user, bukan provider *pay* user.

Jadi reward delivery di codebase Anda (CIP-56 `TransferFactory_Transfer`) **tetap**
apa pun versi DAML — itu satu-satunya primitif platform→user yang ada.

### v27 yang BENAR (hybrid — yang sudah di-implement)

| Flow | Mekanisme | Arah |
|---|---|---|
| **Fee claim** (user → treasury) | `AppPaymentRequest` (locked, anti-preapproval) | user-bayar |
| **Reward** (platform → user) | CIP-56 `TransferFactory_Transfer` (unchanged dari v25) | platform-bayar |

### Yang sudah di-ubah di code (v27 hybrid, DAML 1.4.0 → **1.5.0**):
- DAML `QuestPaymentRequest`: **DROP** field `rewardAmount` (cacat). Fee-only wrapper.
- Backend: `executeClaimPayoutV27` (quests.service.ts) — fee via AppPaymentRequest,
  reward via `sendQuestRewardCip56` (CIP-56). v25 settleAtomic/recordTxId/revealRewardCode
  dihapus. ClaimSlot/DrawWinner drop `rewardSender`, return campaignCid only.
- Reward delivery **tidak berubah** dari v25 (CIP-56) — itu memang tidak bisa di-fix
  via AppPaymentRequest (arah terbalik). Fragilitas preapproval reward tetap ada;
  solusinya = pastikan preapproval always-on saat onboarding (bukan via DAML v27).

### Yang TIDAK berubah / TIDAK bisa di-fix via v27:
- Reward preapproval fragility (itu adalah masalah CIP-56 receiver, bukan DAML).
- Frontend wallet SDK (tidak perlu — Accept custodial oleh backend).

---

## 🎯 KONTEKS UTAMA — Kenapa v27? (DOC ASLI, pre-correction)

> ⚠️ Section di bawah ini adalah **versi asli** doc, sebelum koreksi premise
> di atas. Dipertahankan utk history/konteks. Lihat section KOREKSI di atas
> utk arsitektur yang benar dan sudah di-implement.

v25 (sekarang jalan) pakai `Settle` choice (nested TransferFactory_Transfer,
multi-controller). **Masalah:** receiver butuh TransferPreapproval aktif supaya
reward leg jadi `direct` (1-step). Tanpa preapproval → `offer` (2-step, user
harus accept manual). Preapproval fragile di multi-user.

**v27 solusi:** Ganti reward flow ke `AppPaymentRequest` (Splice DAR template).
AppPaymentRequest_Accept dikontrol sender (user) — explicit consent, no
preapproval needed. Dana terkunci saat accept, platform collect atomik.

---

## 📊 STATUS SAAT INI

| Komponen | Status | Catatan |
|---|---|---|
| **DAML v27** | ✅ Applied + compiled | `659dde1`, DAR `canquest-v27-1.4.0.dar` built di VPS |
| **v25 Settle** | ✅ MASIH JALAN | Jangan deploy v27 sampai Fase 2 backend selesai |
| **Backend v27** | ❌ Belum | Masih pakai v25 settleAtomic/recordTxId |
| **Frontend v27** | ❌ Belum | AppPaymentRequest_Accept UI belum |
| **DAR v27 uploaded?** | ❌ Belum | JANGAN upload sebelum Fase 2 selesai |

---

## 🏗️ ARSITEKTUR v27 (flow reward baru)

### v25 (SEKARANG JALAN) — Settle flow:
```
ClaimSlot → (Campaign, Receipt)
settleAtomic (nested TransferFactory_Transfer, multi-controller) → Settle OK
recordTxId (post-settle)
```

### v27 (TARGET) — AppPaymentRequest flow:
```
1. ClaimSlot/DrawWinner → ContractId QuestCampaign (slot reserved, NO receipt)
2. Backend create QuestPaymentRequest (PENDING) — DAML wrapper
3. Backend create AppPaymentRequest via Ledger API (Splice template)
   → provider = platformParty (utk app rewards built-in)
   → receiverAmounts = [(user, reward), (treasury, fee)]
4. Backend exercise AppPaymentRequest_Accept (custodial, atas nama user)
   → Return: acceptedAppPaymentCid + senderChangeAmulet
5. Backend exercise QuestPaymentRequest.MarkAccepted (simpan acceptedCid)
6. Backend exercise AcceptedAppPayment_Collect
   → Return: receiverAmulets + collectTxId
7. Backend exercise QuestPaymentRequest.MarkSettled (simpan collectTxId)
```

### TIDAK ADA DI DAML v27 (vs v25):
- `QuestClaimReceipt` template — HAPUS
- `Settle` choice — HAPUS
- `RecordTxId` choice — HAPUS
- `RevealCode` choice — HAPUS (kode claim flow beda, TBD)
- `Expire` choice (di receipt) — HAPUS

### YANG TETAP v27:
- `WalletRegistration` (sama)
- `CampaignEligibility` (sama, LOCK_CC/POINTS guard)
- `QuestCampaign` (eligibility guard retained, return changed to ContractId)
- `PlatformTransfer` (sama, atomic send+fee — dormant, flag OFF)

---

## 📐 DAML v27 TEMPLATE DETAIL

### 5 template (`packages/daml/daml/Main.daml`):

1. **WalletRegistration** — identitas on-chain (sama v25)
2. **CampaignEligibility** — eligibility proof LOCK_CC/POINTS (sama v25)
3. **QuestCampaign** — claim + eligibility guard
   - `ClaimSlot` return `ContractId QuestCampaign` (BUKAN tuple lagi)
   - `DrawWinner` return `ContractId QuestCampaign`
   - HAPUS param `rewardSender` dari ClaimSlot/DrawWinner args
   - Tetap ada `eligibilityCid` param (fetch guard)
4. **PlatformTransfer** — atomic send+fee (sama v25, dormant)
5. **QuestPaymentRequest** (NEW) — wrapper AppPaymentRequest lifecycle
   - Field: `appPaymentRequestCid : Text` (contractId sbg string, bukan ContractId typed)
   - Choices: `MarkAccepted`, `MarkSettled`, `MarkExpired`
   - Status: PENDING → ACCEPTED → SETTLED / EXPIRED

---

## 🔧 FASE 2 BACKEND REWRITE — YANG HARUS Dikerjakan

### 2b. NEW methods di QuestLedgerService (`quest-ledger.service.ts`):

**`createQuestPaymentRequest()`** — create DAML QuestPaymentRequest (PENDING)
- Field: admin, userAddress, campaignId, claimId, requestId (UUID),
  appPaymentRequestCid (Text, isi setelah create AppPaymentRequest),
  rewardAmount, feeAmount, token, status="PENDING", createdAt, expiresAt
- TPL: `Main:QuestPaymentRequest`

**`createAppPaymentRequest()`** — create Splice AppPaymentRequest via Ledger API
- Template: `#splice-wallet-payments:Splice.Wallet.Payment:AppPaymentRequest`
- Create args:
  ```typescript
  {
    sender: userParty,
    receiverAmounts: [
      { receiver: userParty, amount: { amount: rewardAmount, unit: ... } },
      { receiver: treasuryParty, amount: { amount: feeAmount, unit: ... } }
    ],
    provider: platformParty,  // CANTON_APP_PROVIDER_PARTY_ID (utk app rewards built-in)
    dso: dsoParty,
    expiresAt: ISO,
    description: text
  }
  ```
- actAs: [admin, userParty] (admin create, sender=user)

**`acceptAppPaymentRequest()`** — exercise AppPaymentRequest_Accept (custodial)
- Choice args (KOMPLEKS):
  ```typescript
  {
    inputs: TransferInput[],        // 8 variant union (InputAmulet, dll)
    context: PaymentTransferContext, // { amuletRules, context: TransferContext }
    walletProvider: party           // wallet provider party
  }
  ```
- ⚠️ INI PALING SULIT. TransferInput butuh query holdings Splice-specific.
  PaymentTransferContext butuh resolve dari AmuletRules (bukan TransferFactory registry).
- actAs: [userParty] (sender = user)
- Return: `{ acceptedPayment: ContractId AcceptedAppPayment, senderChangeAmulet: Optional }`

**`markAccepted()`** — exercise QuestPaymentRequest.MarkAccepted
- Args: `{ acceptedAppPaymentCid: Text, acceptedAt: Text }`
- Simpan acceptedCid ke field appPaymentRequestCid

**`collectAcceptedAppPayment()`** — exercise AcceptedAppPayment_Collect
- Choice args: `{ context: AppTransferContext }`
- actAs: [admin, userParty, platformParty, treasuryParty] (4 party!)
- Return: `{ receiverAmulets: Tuple2<Party, ContractId Amulet>[] }`

**`markSettled()`** — exercise QuestPaymentRequest.MarkSettled
- Args: `{ collectTxId: Text, settledAt: Text }`

### 2c. HAPUS v25 legacy:
- `settleAtomic()` method
- `recordTxId()` method
- TPL.QuestClaimReceipt entry
- `useAtomicSettle` flag (quests.service.ts)
- 5 caller claim path rewrite (hapus settleAndRecord, ganti QuestPaymentRequest flow)

### 2d. Event subscription:
- Detect `AppPaymentRequest_Accept` event → trigger MarkAccepted
- Atau: synchronous (backend exercise Accept langsung, tidak tunggu frontend)

---

## ⚠️ KOMPLEKSITAS TEKNIS (yang saya temukan)

### AppPaymentRequest_Accept — PALING SULIT
Choice args butuh:
- `TransferInput[]` — variant union 8 jenis. Lihat type:
  ```
  packages/frontend/src/daml-types/splice-wallet/splice-wallet-payments-0.1.9/
    lib/Splice/Wallet/Payment/module.d.ts
  ```
  Backend harus query user holdings, resolve ke `InputAmulet` variant.
- `PaymentTransferContext = { amuletRules: ContractId AmuletRules, context: TransferContext }`
  Beda dari TransferFactory registry. Butuh resolve AmuletRules contract.
- `walletProvider` party — party Splice wallet provider (beda dari operator).

### AcceptedAppPayment_Collect — 4 party rights
`actAs: [admin, userParty, platformParty, treasuryParty]`
- Service-account butuh CanActAs utk semua 4 party
- Cek: WALLET_USER_PROXY_SETUP.md party list
- Mungkin butuh grant rights tambahan (lihat docs/RUNBOOK_GRANT_ANY_PARTY_RIGHTS.md)

### DAR dependency
DAML v27 TIDAK butuh `splice-wallet-payments` DAR di data-dependencies
(AppPaymentRequest via Ledger API, bukan DAML import). 4 DAR v25 tetap cukup.
TAPI participant node sudah punya AppPaymentRequest (bawaan Splice).

---

## 📦 DOKUMENTASI PENDUKUNG di repo

| File | Isi |
|---|---|
| `docs/RUNBOOK_DAML_V25_DEPLOY.md` | Deploy v25 + 10 test matrix |
| `docs/RUNBOOK_DAML_V24_DEPLOY.md` | Deploy v24 (history) |
| `docs/RUNBOOK_GRANT_ANY_PARTY_RIGHTS.md` | Grant CanActAs rights |
| `docs/RUNBOOK_ATOMIC_SETTLE.md` | Diagnosa atomic (history v24 debug) |
| `docs/WALLET_USER_PROXY_SETUP.md` | Party list + config |
| `HANDOFF_DAML_V23.md` | Konteks awal (history) |

---

## 🗂️ KOMIT HARI INI (urutan)

```
659dde1 feat(daml): v27 — arsitektur reward AppPaymentRequest (rewrite dari v25 Settle)
f6976f6 feat(api): eligibility pre-check endpoint + EN error messages
19f4ce6 fix(api): sendCc cip56Result null-safety + transferInstructionCid type
2e57d43 fix(api): hapus blok rusak sisa Fase 5b
6522187 feat(api): Fase 5 — send CC atomic via PlatformTransfer (feature flag)
109ef3a docs: runbook DAML v25 deploy
189964b feat(api): v25 Fase 3 — business logic wiring
ac6f852 feat(api): v25 Fase 2 — backend DAML glue
85a731b feat(daml): v25 Fase 1 — contract + DB schema
26dfe82 cleanup: hapus AUTH_DEBUG log
... (v24 fixes sebelumnya)
```

---

## 🎯 NEXT STEP (Fase 2 — besok)

1. Baca doc ini
2. Mulai Fase 2b: NEW methods QuestLedgerService (createQuestPaymentRequest dulu — paling gampang)
3. Fase 2c: AppPaymentRequest Accept (paling sulit — TransferInput + context)
4. Fase 2d: Collect + MarkSettled
5. Fase 2e: Rewrite 5 caller claim path
6. Fase 2f: Build + test di VPS
7. HANYA SETELAH Fase 2 sukses: upload DAR v27 + restart backend

**JANGAN upload DAR v27 atau restart backend sebelum Fase 2 selesai.**
v25 Settle tetap jalan sampai Fase 2 deploy.

---

## 🧪 TEST YANG SUDAH VERIFIED (v25, masih jalan)

- ✅ Settle OK (atomic fee+reward, multi-controller)
- ✅ Eligibility LOCK_CC (lock setelah campaign)
- ✅ Eligibility POINTS
- ✅ CampaignEligibility contract created + fetch guard
- ✅ Pre-check endpoint `/claim-eligibility`

v27 akan replace flow ini dengan AppPaymentRequest (lebih clean, no preapproval).
