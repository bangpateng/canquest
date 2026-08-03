# Inventory Transaksi Onchain CanQuest (untuk menyusun DAML baru)

> **Tujuan dokumen:** Bahan untuk merancang **DAML contract baru** dan untuk
> ditanyakan ke **AI Dokumentasi Canton**.
>
> **Penting:** DAML lama (`packages/daml` = `canquest-v21`) **sudah tidak
> terpakai / akan diganti**. Dokumen ini BUKAN inventaris DAML lama, melainkan
> inventaris **apa yang dapp BENAR-BENAR lakukan onchain hari ini** di Canton
> Network + Splice Token Standard (CIP-56), dari sisi bisnis, agar DAML baru
> bisa dirancang dari nol sesuai kebutuhan riil.

---

## 1. Gambaran Dapp

CanQuest = platform Web3 quest berbasis **Canton Network** (validator app mode,
M3+/Module 4). Stack: NestJS backend (operator/custodial) + Next.js frontend.

**Model custody:** CUSTODIAL. Backend (operator party) submit hampir semua
command onchain atas nama user. User punya wallet party Canton tapi (saat ini)
tidak self-submit command DAML — semua lewat backend. (Pertanyaan ke Canton AI:
apakah ini best practice atau harus migrasi ke self-custody via WalletUserProxy.)

---

## 2. Party yang Terlibat Onchain

| Party | Env | Peran bisnis |
|---|---|---|
| Operator / Admin | `CANTON_OPERATOR_PARTY_ID` (fallback `CANTON_VALIDATOR_PARTY_ID`) | Signer DAML, submit semua command |
| Validator | `CANTON_VALIDATOR_PARTY_ID` | Node validator, admin wallet user |
| DSO | `CANTON_DSO_PARTY_ID` | Admin instrumen Amulet (CC) |
| Reward | `CANTON_REWARD_PARTY_ID` (fallback validator) | Wallet sumber distribusi CC reward |
| Fee / Treasury | `CANTON_FEE_RECIPIENT_PARTY_ID` | Penerima platform fee (send-cc, send-token) |
| Validator-fee target | `canquest-fee` / validator party | Penerima claim fee quest |
| Lock holder | `CANTON_LOCK_HOLDER_PARTY` (fallback validator) | Pemegang lock CC |
| App Provider | `CANTON_APP_PROVIDER_PARTY_ID` | Featured app (untuk FAR + WalletUserProxy) |
| User parties | dinamis (alokasi saat onboarding) | Wallet user, holder CC/token |
| OneSwap deposit party | dinamis (dari `createSwap`) | Deposit address DEX |

---

## 3. Fungsi Bisnis → Operasi Onchain NYATA

Hanya operasi yang BENAR-BENAR dieksekusi di ledger hari ini. DAML lama
(canquest-v21) **tidak dihitung** karena akan diganti.

### 3.1 Wallet Onboarding & Identitas
**Tujuan:** User daftar → dapat party Canton → anchor identitas onchain.

Operasi onchain saat ini:
- `POST /v2/parties` — alokasi party baru (fallback path)
- `POST /v2/users` + rights — buat ledger API user, link Keycloak UUID
- Splice Validator: `POST /api/validator/v0/admin/users` — alokasi party via Splice
- (DAML lama `WalletRegistration` create — **diabaikan, akan dibuat baru**)

State yang perlu dilacak: partyId, username, inviteCode, registeredAt.

**Pertanyaan DAML baru:** apakah perlu kontrak identitas onchain
(`WalletRegistration` baru), atau cukup party allocation saja?

---

### 3.2 Transfer CC / Token P2P (CIP-56)
**Tujuan:** User kirim CC/USDCx ke user lain, dengan platform fee.

Alur onchain (CIP-56, 2-step):
1. **Transfer utama** — 1 dari 3 path:
   - `TransferFactory_Transfer` (direct, bila receiver ada TransferPreapproval)
   - `WalletUserProxy_TransferFactory_Transfer` (bila FeaturedAppRight aktif)
   - `WalletUserProxy_BatchTransfer` (fallback bila FAR kosong)
   - Jika receiver tidak punya preapproval → hasilnya **TransferInstruction pending** (offer), butuh accept manual
2. **Fee transfer** — `TransferFactory_Transfer` CC user → treasury party
   - Bila offer → `TransferInstruction_Accept` oleh fee party

Pre-step: query holdings (`queryAmuletHoldings` untuk CC, `getTokenHoldingCids` via InterfaceFilter untuk non-CC) → `inputHoldingCids`.

**Masalah atomicity saat ini:** transfer utama + fee = 2 transaksi terpisah, BISA gagal partial. Ini salah satu alasan utama mau buat DAML baru.

Idempotency: `commandId` deterministik dari SHA256(sender|receiver|amount|clientNonce).

---

### 3.3 Offer Inbox (Accept / Reject / Withdraw)
**Tujuan:** Receiver terima/tolak incoming TransferInstruction; sender cancel outgoing.

Operasi onchain (per offer):
- `TransferInstruction_Accept` — receiver accept → holding pindah
- `TransferInstruction_Reject` — receiver tolak → holding kembali ke sender
- `TransferInstruction_Withdraw` — sender cancel sebelum settle
- Atau via proxy: `WalletUserProxy_TransferInstruction_Accept/Reject/Withdraw`
- Legacy: `TransferOffer_Accept` / `TransferOffer_Reject` (Splice.Wallet.TransferOffer)

3 jenis offer yang dikenali dapp: CIP-56 TransferInstruction, AmuletTransferInstruction, Utility Registry TransferOffer (USDCx).

---

### 3.4 TransferPreapproval (Direct Transfer)
**Tujuan:** Receiver enable direct transfer (skip offer/accept round-trip). Provider pre-pay fee burn ~1.5 CC.

Operasi onchain:
- `AmuletRules_CreateTransferPreapproval` — atomic create + fee burn
- `TransferPreapproval_Cancel` — disable
- Disclosure: AmuletRules + OpenMiningRound (DSO-signed blobs dari scan-proxy)

Verifikasi: union 3 sumber (ledger receiver view + provider view + splice REST) untuk hindari false-negative.

---

### 3.5 Lock / Unlock CC (LockedAmulet)
**Tujuan:** User kunci CC untuk jangka waktu N (Earn tiers / loyalty), kembali utuh di expiresAt.

Operasi onchain:
- `AmuletRules_Transfer` (self-lock) → create `LockedAmulet` dengan `{holders:[lockHolder], expiresAt}`
- `LockedAmulet_OwnerExpireLockV2` — unlock setelah jatuh tempo
- Pre-step: greedy fill holdings ≥ amount, disclosure OpenMiningRound

State dilacak offchain: `cc_locks` table (reconcile 2-arah dengan chain).

---

### 3.6 Swap via OneSwap (DEX eksternal Canton)
**Tujuan:** User swap CC ↔ USDCx via DEX pihak ketiga.

Model: **custodial deposit-then-return** (atomic DvP):
1. `oneswap.createSwap` → dapat `depositParty` + deadline 60 menit
2. **`TransferFactory_Transfer`** input user → `depositParty` ← satu-satunya DAML call di flow swap
3. OneSwap deteksi deposit → eksekusi swap atomik di pool
4. Output **balik ke senderParty** (user), tanpa co-sign DvP, tanpa gas

Idempotency: `clientNonce` di `SwapTransaction`. In-flight guard per user.

---

### 3.7 Quest Campaign & Distribusi Reward
**Tujuan:** Admin buat campaign → user klaim → fee user + reward ke user.

Operasi onchain per claim:
1. **Collect claim fee** — `TransferFactory_Transfer` CC user → fee/validator party (+ optional `TransferInstruction_Accept`)
2. **Send reward** — `TransferFactory_Transfer` CC/token dari reward wallet → user
3. (DAML lama `AtomicFeeAndReward` — **diabaikan**; ini cuma receipt, bukan atomic sungguhan)

**Masalah utama yang mau diselesaikan DAML baru:**
- Kuota FCFS anti-sybil (saat ini: backend Postgres lock + DAML lama guard yang tidak terpakai)
- Atomicity fee+reward (saat ini 2 tx terpisah, bisa gagal partial)
- Idempotency claim (saat ini: DB row lock, bukan contract key)
- State machine campaign (DRAFT/ACTIVE/PAUSED/ENDED/CLOSED)

Reward type → quest kind:
| RewardType | questKind |
|---|---|
| CC_ONLY / CC_AND_INVITE | CC_FCFS / CC_RAFFLE |
| CC_MANUAL | CC_RAFFLE |
| INVITE_CODE_FCFS | CODE_FCFS |
| INVITE_CODE_RANDOM / INVITE_CODE | CODE_RAFFLE |
| CC_AND_CODE_RAFFLE | CC_AND_CODE_RAFFLE |
| WAITLIST_EMAIL | WAITLIST |

Default fee per type: 2 CC (code), 3 CC (cc-only/manual), 5 CC (cc+code raffle).

---

### 3.8 Featured App Activity Marker (Module 4)
**Tujuan:** Catat aktivitas user untuk app reward coupons.

Operasi onchain:
- **create** `Splice.Amulet:FeaturedAppActivityMarker` dengan `activityType`:
  `wallet_created`, `quest_completed`, `cc_transfer`, `task_verified`

Signer: appProviderPartyId. Gated `FEATURED_APP_MARKERS_ENABLED=true` (MainNet only).

---

### 3.9 Realtime Subscribe (READ-ONLY, bukan DAML contract)
- WSS `/v2/updates` wildcard subscription oleh service-account (`CanReadAsAnyParty`)
- Dispatch event created/archived/exercised ke: balance sync, offer reconciler, SSE frontend
- Pilihan DAML yang diproses dari stream: `TransferInstruction_Accept/Reject/Withdraw`, `TransferFactory_Transfer`, `LockedAmulet_OwnerExpireLockV2`

---

## 4. Yang TIDAK Onchain (sengaja, di Postgres)

Penting Canton AI tahu, supaya tidak disarankan dipindah ke DAML:
- Poin user (earnedPoints/spentPoints) → DB
- Daily check-in (cooldown 24h) → DB
- Referral reward → DB
- Random draw pemenang raffle → backend (random pick off-chain)
- Validasi sybil/task verification → DB
- Status campaign update (saat ini) → DB

---

## 5. Pertanyaan untuk Canton Docs AI (siap tempel)

```
I'm designing a NEW set of DAML contracts for a Canton Network dapp
(validator app mode, custodial operator pattern, M3+/Module 4).
The existing DAML is being replaced. Here's what the dapp ACTUALLY does
onchain today, mostly via the Canton Token Standard (CIP-56):

PARTIES:
- Operator/admin party: signs & submits almost all DAML commands
- Reward party: wallet holding CC for quest reward distribution
- Fee/treasury party: receives platform fees
- Lock holder party: holds locked CC
- App provider party: featured app (FAR + WalletUserProxy)
- User parties: wallets, currently observer-only (no self-submit)

CURRENT ONCHAIN OPERATIONS (all via Canton Token Standard / CIP-56,
NOT yet modeled in my own DAML):

1. CC/token P2P transfer (CIP-56 2-step):
   TransferFactory_Transfer; if receiver lacks preapproval →
   TransferInstruction pending → receiver Accept/Reject, sender Withdraw.
   Proxy variants: WalletUserProxy_TransferFactory_Transfer,
   WalletUserProxy_BatchTransfer, WalletUserProxy_TransferInstruction_*.
   Platform fee = separate TransferFactory_Transfer to treasury party.

2. TransferPreapproval: AmuletRules_CreateTransferPreapproval,
   TransferPreapproval_Cancel.

3. Lock/unlock CC: AmuletRules_Transfer (self-lock → LockedAmulet),
   LockedAmulet_OwnerExpireLockV2.

4. Swap via external DEX (OneSwap, custodial deposit-then-return):
   only onchain step = TransferFactory_Transfer user→depositParty.

5. Quest campaign + reward distribution: collect claim fee (user→fee party)
   + send reward (reward party→user) = currently 2 SEPARATE transactions
   that can fail partial.

6. FeaturedAppActivityMarker create (Module 4).

BUSINESS INVARIANTS I need DAML to enforce:
- Quest campaign FCFS quota anti-sybil (maxWinners, currentClaims atomic)
- Raffle/winner draw only by admin
- Fee must be confirmed before reward released (ordering)
- Claim idempotency per (campaignId, userAddress)
- Campaign state machine: DRAFT/ACTIVE/PAUSED/ENDED/CLOSED (no reopen)

QUESTIONS:
1. For fee+reward atomicity: today I do 2 separate CIP-56 transfers
   (user→fee party, reward party→user). They can fail partial. What's the
   idiomatic Canton way to make fee-collection + reward-disbursement truly
   atomic? DAML choice that exercises both, backend orchestration with
   shared commandId, or is there a Canton primitive for atomic multi-leg
   transfers across different senders?

2. Custodial pattern: operator signs everything, user is observer. Is this
   best practice, or should users self-custody via WalletUserProxy /
   FeaturedAppRight? Trade-offs?

3. Anti-sybil FCFS quota: I currently enforce in BOTH DAML and backend
   (Postgres FOR UPDATE lock). Is double-guarding idiomatic Canton, or
   should I rely on DAML only / backend only?

4. Claim idempotency: backend row-lock today. How to enforce uniqueness
   per (campaignId, userAddress) idiomatically in Canton DAML — contract
   key + key maintenance on archive, or disclosed-contract pattern?

5. State machine campaign on-chain: currently off-chain (DB only). Does
   on-chain campaign status (DRAFT→ACTIVE→CLOSED) provide real value, or
   is create-immutable + off-chain lifecycle preferred?

6. Should quest campaign, quest claim, and fee/reward settlement be ONE
   template with choices, or split across templates? Canton best practice
   for modeling a multi-step lifecycle (reserve slot → pay fee → receive
   reward) with strong atomicity guarantees?

7. Given my dapp uses CIP-56 TransferFactory for all CC movement, where
   exactly should my own DAML boundary sit vs. delegating to the token
   standard? I want DAML to own anti-sybil + atomicity, token standard
   owns CC movement.

Please recommend a DAML contract architecture (templates, choices,
controllers, contract keys) that fits this model.
```
