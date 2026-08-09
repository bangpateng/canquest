# HANDOFF — DAML v27 (AppPaymentRequest Architecture Migration)

> **Tanggal:** 2026-08-09 (updated: Fase 2 backend code COMPLETE, mainnet deploy pending)
> **HEAD:** `feat/daml-v27-fase2-backend` branch (6 commit, merge ke master saat siap)
> **Status:** DAML v27 compiled (DAR built di VPS), v25 Settle **MASIH JALAN** sebagai fallback (flag QUEST_V27_FLOW=false default)
>
> ⚠️ **Koreksi akurasi (2026-08-09):** HEAD aktual = `35d8bfc` (bukan `659dde1` seperti tertulis di versi doc sebelumnya). Commit `659dde1` tidak ditemukan di git log — kemungkinan typo. DAR `canquest-v27-1.4.0.dar` **dibuild di VPS**, bukan di repo lokal (folder `.daml/dist/` & `target/` lokal kosong — ini wajar).
> **Tujuan doc ini:** Konteks lengkap utk chat baru, supaya tidak keluar jalur.

---

## 📋 CARA PAKAI DOC INI DI CHAT BARU

Copy-paste prompt ini di awal chat baru:

```
Saya melanjutkan DAML v27 migration (Fase 2 backend rewrite).
Detail lengkap ada di 2 file:
1. HANDOFF_DAML_V27.md (root repo) — status + plan
2. docs/V27_MASTER_FLOW_REFERENCE.md — master flow lengkap dari Canton AI

Singkatnya: DAML v27 sudah applied + compiled (DAR built, commit 659dde1).
Backend belum rewrite — masih pakai v25 Settle yang jalan.
Fase 2 = backend rewrite utk reward flow v27 (2 PATH: PlatformTransfer + AppPaymentRequest).

Tolong baca KEDUA file itu utk konteks lengkap, lalu bantu saya
kerjakan Fase 2 (bertahap, terverifikasi, tidak terburu-buru).

Branch master, HEAD 659dde1 (atau check git log terbaru).
```

---

## 🎯 INSIGHT BARU (update 2026-08-09) — 2 PATH reward flow

Dari master flow reference (docs/V27_MASTER_FLOW_REFERENCE.md), v27 reward claim punya **2 PATH**:

| Path | Kondisi | Flow | User action |
|---|---|---|---|
| **A** | CC + preapproval valid | PlatformTransfer.ExecuteTransfer (sudah ada di v27!) | ❌ Instan |
| **B** | CC no preapproval ATAU USDCx | AppPaymentRequest → Accept → Collect | ✅ User accept |

**PATH A pakai PlatformTransfer yang SUDAH kita build** (Fase 5 v25). Hanya PATH B yang butuh AppPaymentRequest (complex). Ini mengurangi scope Fase 2 — Path A bisa jalan duluan.

Baca docs/V27_MASTER_FLOW_REFERENCE.md untuk detail lengkap flow + actAs + koreksi kritis.

---

## 🎯 KONTEKS UTAMA — Kenapa v27?

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
| **DAML v27** | ✅ Applied + compiled | HEAD `35d8bfc`, source di `packages/daml/daml/Main.daml` (5 template) |
| **DAR v27 built** | ✅ Built di VPS | `canquest-v27-1.4.0.dar` dibuild di VPS (bukan repo lokal). Folder `.daml/dist/` lokal sengaja kosong |
| **v25 Settle** | ✅ MASIH JALAN | Jangan deploy v27 sampai Fase 2 backend selesai |
| **Backend v27** | ✅ Fase 2 code COMPLETE | 6 commit di branch `feat/daml-v27-fase2-backend`. PATH A + PATH B implemented di-belakang flag `QUEST_V27_FLOW`. v25 fallback intact. |
| **Frontend v27** | ❌ Belum (Fase 3) | AppPaymentRequest_Accept UI belum. Fase 2 pakai sync Accept custodial (backend exercise Accept atas nama user) — tidak butuh frontend utk PATH A/B |
| **DAR v27 uploaded?** | ❌ Belum | Upload saat deploy mainnet (lihat `docs/RUNBOOK_DAML_V27_DEPLOY.md` §3) |
| **AppPaymentRequest DAR** | ℹ️ Native Splice | Bukan DAR milik kita — bagian participant node bawaan. Backend akses via Ledger API JSON-RPC |
| **Runbook deploy** | ✅ `docs/RUNBOOK_DAML_V27_DEPLOY.md` | MAINNET-specific: FAR off, PATH A duluan, amount kecil |

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

## 🎯 NEXT STEP (Fase 2 code DONE — deploy mainnet next)

**Fase 2 backend rewrite COMPLETE** (6 commit di branch `feat/daml-v27-fase2-backend`):

| Step | Commit | Isi |
|---|---|---|
| 0 | `e1808ad` | Fix HANDOFF accuracy (HEAD hash + DAR location) |
| 1 | `454fa04` | DB Migration: WinnerDraw +6 kolom v27 payment tracking (nullable) |
| 2 | `71db1e0` | Fase 2a PATH A Ledger Methods (createQuestPaymentRequest + executePlatformTransferReward + markSettled) |
| 3 | `8497651` | Fase 2a Caller Integration (useV27Flow + settleAndRecordV27 + 3 caller branch) |
| 4 | `f89bf2a` | Fase 2b PATH B Ledger Methods (createAppPaymentRequest + acceptAppPaymentRequest + markAccepted + collectAcceptedAppPayment + markExpired) |
| 5 | `d5cc2ca` | Fase 2b Wiring + Hardening (PATH B routing + error recovery + idempotency) |

**NEXT — deploy mainnet** (lihat `docs/RUNBOOK_DAML_V27_DEPLOY.md`):
1. Merge `feat/daml-v27-fase2-backend` ke master
2. DB migration (nullable, zero-risk)
3. Upload DAR v27 ke participant mainnet
4. Set `CANTON_DAML_PACKAGE_NAME` ke hash v27
5. Verify CanActAs rights (PATH B butuh 5-party + 4-party + 2-party)
6. Test PATH A duluan (CC + preapproval ON, amount kecil)
7. Test PATH B (CC no preapproval atau USDCx)
8. Setelah verified ≥ 1 minggu: Step 7 v25 cleanup

**v25 Settle tetap jalan** sebagai fallback (flag `QUEST_V27_FLOW=false` default).
Rollback safety: set `QUEST_V27_FLOW=false` + restart → kembali ke v25 instan.

⚠️ **MAINNET constraints:** FAR belum approved (off) — transfer jalan tanpa app rewards. DSO party dari MainNet scan endpoint. Funding REWARD_SENDER wajib real CC.

---

## 🧪 TEST YANG SUDAH VERIFIED (v25, masih jalan)

- ✅ Settle OK (atomic fee+reward, multi-controller)
- ✅ Eligibility LOCK_CC (lock setelah campaign)
- ✅ Eligibility POINTS
- ✅ CampaignEligibility contract created + fetch guard
- ✅ Pre-check endpoint `/claim-eligibility`

v27 akan replace flow ini dengan AppPaymentRequest (lebih clean, no preapproval).
