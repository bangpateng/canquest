# CanQuest v27 — Master Flow Reference (dari Canton AI)

> **Sumber:** Dokumentasi Canton AI + Splice docs (2026-08-09)
> **Status:** Reference material utk implementasi v27 Fase 2 backend
> **PENTING:** Dokumen ini adalah SOURCE OF TRUTH utk flow v27. Baca sebelum coding Fase 2.

---

## 🎯 INSIGHT KUNCI — 2 PATH (A & B) berdasarkan Preapproval

v27 reward claim punya **2 path** berdasarkan kondisi user preapproval:

```
User Claim Reward
      │
      ▼
ClaimSlot / DrawWinner
      │
      ▼
token == "USDCx"? ──YES──→ PATH B (AppPaymentRequest)
      │
      NO (CC)
      │
      ▼
Preapproval valid? ──YES──→ PATH A (PlatformTransfer, instan, 0 user action)
      │
      NO
      │
      ▼
PATH B (AppPaymentRequest, user accept, max 10 menit)
```

| Kondisi | Path | Flow | User action |
|---|---|---|---|
| CC + preapproval ON + belum expired | **A** | PlatformTransfer.ExecuteTransfer (atomic 3 leg) | ❌ Instan |
| CC + preapproval OFF | **B** | AppPaymentRequest → Accept → Collect | ✅ Accept |
| CC + preapproval expired | **B** | AppPaymentRequest (fallback) | ✅ Accept |
| USDCx (apapun) | **B** | AppPaymentRequest (selalu) | ✅ Accept |
| CODE reward (bukan token) | — | Tidak perlu payment flow | — |

---

## 🌍 ENVIRONMENT & PARTY IDS

```env
# ENDPOINTS
KEYCLOAK_URL=https://auth.canquestlabs.com
LEDGER_URL=https://ledger.canquestlabs.com
VALIDATOR_URL=https://validator.canquestlabs.com

# PARTY IDS
ADMIN_PARTY=canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
PLATFORM_FEE_PARTY=canquest-fee::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
REWARD_SENDER_PARTY=canquest-reward-user::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
APP_PROVIDER_PARTY=app-canquest::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
WALLET_PROVIDER_PARTY=canquest-validator-1::12209fe74271728c49a1922362aa0c8d2bff7f7546b81963b7d5b65361fd8e5442fb
DSO_PARTY=<ambil dari Scan API Canton Network, JANGAN hardcode>

# DAML PACKAGE
PACKAGE_ID=canquest-v27

# FAR (FeaturedAppRight) Interface ID — FIXED, tidak berubah
FAR_INTERFACE_ID=7804375fe5e4c6d5afe067bd314c42fe0b7d005a1300019c73154dd939da4dda:Splice.Api.FeaturedAppRightV1:FeaturedAppRight
```

---

## 📋 FLOW LENGKAP PER MODUL

### MODUL 1 — REGISTRASI USER
- actAs: `[ADMIN_PARTY]`
- Create WalletRegistration (immutable, 1 per user)
- External party setup (preapproval) via `POST /v0/admin/external-party/setup-proposal`
- provider = ADMIN_PARTY (validator operator) → auto-renew preapproval aktif

### MODUL 2 — MANAJEMEN CAMPAIGN
- actAs: `[ADMIN_PARTY]`
- Create QuestCampaign (DRAFT) → Activate → ACTIVE
- ⚠️ WAJIB pre-fund REWARD_SENDER_PARTY sebelum Activate
- State machine: DRAFT→ACTIVE→PAUSED→ACTIVE→ENDED→CLOSED

### MODUL 3 — ELIGIBILITY USER
- actAs: `[ADMIN_PARTY]`
- LOCK_CC: user lock via AmuletRules, create CampaignEligibility (guard lockedAt > campaignCreatedAt)
- POINTS: PointsService.getNetPoints >= min, create CampaignEligibility
- Lifecycle: ELIGIBLE → RevokeEligibility/ExpireEligibility

### MODUL 4 — CLAIM REWARD (CORE — 2 PATH)

#### STEP 1 — ClaimSlot / DrawWinner
- actAs: `[ADMIN_PARTY]`
- Exercise QuestCampaign.ClaimSlot (FCFS) atau DrawWinner (Raffle)
- Atomic anti-sybil (consuming choice, ledger conflict)
- Output: ContractId QuestCampaign (baru, currentClaims+1)

#### STEP 2 — Cek token & preapproval
```
token == "USDCx"? → PATH B (selalu)
token == "CC" + preapproval valid → PATH A
token == "CC" + no preapproval/expired → PATH B
```

#### PATH A — PREAPPROVAL ON (CC only, instan)
- STEP 3A: Create QuestPaymentRequest (PENDING), appPaymentRequestCid="" (kosong)
- STEP 4A: Create PlatformTransfer + ExecuteTransfer
  - actAs: `[ADMIN, REWARD_SENDER, userPartyId, APP_PROVIDER]`
  - Leg 1: REWARD_SENDER → userPartyId (reward, via preapproval = direct)
  - Leg 2: userPartyId → PLATFORM_FEE (fee)
  - Leg 3: FAR marker → APP_PROVIDER
  - **ATOMIC 1 TX, 0 user action**
- STEP 5A: QuestPaymentRequest.MarkSettled (collectTxId dari step 4A)

#### PATH B — PREAPPROVAL OFF (CC atau USDCx, butuh user accept)
- STEP 3B: Create QuestPaymentRequest (PENDING)
- STEP 4B: Create AppPaymentRequest via Ledger API
  - templateId: `Splice.Wallet.Payment:AppPaymentRequest`
  - actAs: `[ADMIN, REWARD_SENDER, APP_PROVIDER, userPartyId, PLATFORM_FEE]`
  - sender = REWARD_SENDER, provider = APP_PROVIDER, dso = DSO_PARTY
  - receiverAmounts = [(user, reward), (fee_party, fee)]
- STEP 5B: User Accept (frontend)
  - actAs: `[userPartyId, WALLET_PROVIDER]`
  - inputs = TransferInput[] (UTXO CC user), context = PaymentTransferContext
  - Output: acceptedAppPaymentCid + senderChangeAmulet
- STEP 6B: MarkAccepted (backend event subscription)
  - actAs: `[ADMIN]`
  - Update appPaymentRequestCid = acceptedAppPaymentCid
- STEP 7B: Collect (backend)
  - actAs: `[REWARD_SENDER, APP_PROVIDER, userPartyId, PLATFORM_FEE]` (4 signatory!)
  - context = AppTransferContext
  - ATOMIC 1 TX: LockedAmulet dilepas, user + fee terima, FAR built-in
- STEP 8B: MarkSettled

### MODUL 5 — FLOW GAGAL / EXPIRED
- TIMEOUT: cron scheduler, AppPaymentRequest_Expire + MarkExpired("TIMEOUT")
- REJECTED: detect reject event, MarkExpired("REJECTED")
- WITHDRAWN: AppPaymentRequest_Withdraw + MarkExpired("WITHDRAWN")
- CANCELLED: AcceptedAppPayment_Expire (dana kembali otomatis), MarkExpired("CANCELLED")

### MODUL 6 — SEND TOKEN P2P + FEE
- actAs: `[ADMIN, userPartyId]`
- Create PlatformTransfer + ExecuteTransfer
- Leg 1: user → receiver, Leg 2: user → PLATFORM_FEE, Leg 3: FAR marker
- ATOMIC 1 TX

---

## ⚠️ KOREKSI KRITIS (dari Canton AI)

### 1. DSO_PARTY_ID — endpoint benar
```
DevNet:  GET https://scan.sv-1.dev.global.canton.network.sync.global/v0/dso-party-id
TestNet: GET https://scan.sv-1.test.global.canton.network.sync.global/v0/dso-party-id
MainNet: GET https://scan.sv-1.global.canton.network.sync.global/v0/dso-party-id
Response: { "dso_party_id": "DSO::..." }
```
Bukan scan.canquestlabs.com. Cache saat startup, JANGAN hardcode.

### 2. FeaturedAppRight setup
- DevNet: `POST /v0/wallet/self-grant-feature-app-right` (self-feature, langsung)
- MainNet: submit ke Canton Foundation, tunggu approval
- Query FAR contractId via Ledger API (interface filter FAR_INTERFACE_ID)
- Cache sebagai FAR_CONTRACT_ID

### 3. Preapproval auto-renew
- provider = ADMIN_PARTY (validator operator) → auto-renew aktif (renew bila < 30 hari)
- TIDAK perlu backend handle renewal
- Cek: `GET /v0/admin/transfer-preapprovals/by-party/{userPartyId}`
- Cancel: `DELETE /v0/admin/transfer-preapprovals/by-party/{userPartyId}`

### 4. FAR marker — KAPAN BOLEH
- ✅ BOLEH: reward claim (ExecuteTransfer), P2P send, mint/burn, lock/unlock RWA
- ❌ JANGAN: WalletRegistration create, CampaignEligibility, ClaimSlot/DrawWinner, MarkAccepted/MarkSettled, Activate/Pause
- Pelanggaran = review/penalti Tokenomics Committee CF

### 5. expiresAt sinkron
- QuestPaymentRequest.expiresAt == AppPaymentRequest.expiresAt (WAJIB sama persis)

---

## 📊 RINGKASAN actAs

| Operasi | actAs Wajib |
|---|---|
| Register / Campaign CRUD | `[ADMIN]` |
| ClaimSlot / DrawWinner | `[ADMIN]` |
| Create QuestPaymentRequest | `[ADMIN]` |
| MarkAccepted / MarkSettled / MarkExpired | `[ADMIN]` |
| **PATH A: ExecuteTransfer** | `[ADMIN, REWARD_SENDER, userPartyId, APP_PROVIDER]` |
| **PATH B: Create AppPaymentRequest** | `[ADMIN, REWARD_SENDER, APP_PROVIDER, userPartyId, PLATFORM_FEE]` |
| **PATH B: AppPaymentRequest_Accept** | `[userPartyId, WALLET_PROVIDER]` |
| **PATH B: AcceptedAppPayment_Collect** | `[REWARD_SENDER, APP_PROVIDER, userPartyId, PLATFORM_FEE]` |
| ExecuteTransfer (P2P Send) | `[ADMIN, userPartyId]` |

---

## ✅ CHECKLIST PRODUCTION

```
PRE-LAUNCH:
□ DSO_PARTY_ID dari Scan API Canton Network (cache startup)
□ FeaturedAppRight setup (DevNet: self-grant / MainNet: CF approval)
□ FAR_CONTRACT_ID di-query + cache startup
□ REWARD_SENDER_PARTY pre-funded (>= rewardCc × maxWinners + 10% buffer)
□ External party setup provider = ADMIN_PARTY (auto-renew preapproval)
□ Event stream subscriber 24/7 + reconnect handler
□ Cron scheduler timeout handler tiap 1 menit

PER TRANSAKSI:
□ Cek preapproval (CC only): GET /v0/admin/transfer-preapprovals/by-party/{userPartyId}
□ Cek saldo REWARD_SENDER sebelum AppPaymentRequest
□ expiresAt QuestPaymentRequest == AppPaymentRequest (sinkron)
□ actAs AcceptedAppPayment_Collect = SEMUA 4 signatory
□ FAR marker HANYA di ExecuteTransfer & Collect (bukan housekeeping)
□ USDCx → selalu PATH B
□ FCFS conflict → JANGAN retry, re-fetch campaign
```
