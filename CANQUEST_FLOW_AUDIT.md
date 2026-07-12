# CanQuest DApp — Flow Audit Lengkap

> Dokumen ini hasil audit menyeluruh codebase CanQuest untuk dikonsultasikan ke AI Canton Network.
> Mencakup: arsitektur, integrasi Canton, integrasi Cantex DEX, auth, swap, reward, lock, dan daftar pertanyaan/masalah yang perlu dibereskan.

---

## Daftar Isi

1. [Arsitektur Overview](#1-arsitektur-overview)
2. [Auth & User Identity](#2-auth--user-identity)
3. [Party Allocation & Wallet Onboarding](#3-party-allocation--wallet-onboarding)
4. [CC Transfer Flow (CIP-0056)](#4-cc-transfer-flow-cip-0056)
5. [TransferPreapproval Lifecycle](#5-transferpreapproval-lifecycle)
6. [Cantex DEX Swap Flow](#6-cantex-dex-swap-flow)
7. [Cantex Signers (Ed25519 + secp256k1)](#7-cantex-signers-ed25519--secp256k1)
8. [CC Lock Flow](#8-cc-lock-flow)
9. [Quest / Reward / Earn Flow](#9-quest--reward--earn-flow)
10. [Balance Sync (On-chain ↔ Off-chain)](#10-balance-sync-on-chain--off-chain)
11. [Keycloak Integration](#11-keycloak-integration)
12. [Realtime / SSE](#12-realtime--sse)
13. [Wallet Password / PIN Gate](#13-wallet-password--pin-gate)
14. [Frontend Flow](#14-frontend-flow)
15. [Infrastructure & Deployment](#15-infrastructure--deployment)
16. [Prisma Schema Overview](#16-prisma-schema-overview)
17. [Env Config Reference](#17-env-config-reference)
18. [⚠️ Pertanyaan untuk AI Canton Network](#18-️-pertanyaan-untuk-ai-canton-network)
19. [🐛 Known Issues & Technical Debt](#19--known-issues--technical-debt)

---

## 1. Arsitektur Overview

### Stack
- **Backend**: NestJS API (`apps/api`), Node 20+, PM2 fork mode single instance
- **Frontend**: Next.js 15 (`apps/web`), Vercel deploy
- **DB**: PostgreSQL (Supabase Frankfurt Free tier)
- **Queue**: Redis + BullMQ (ledger jobs)
- **Auth**: Supabase Auth (ES256 JWT) + legacy bcrypt (HS256 JWT) dual-mode
- **Realtime**: SSE (Server-Sent Events)

### Topologi Canton Network
```
┌─────────────────────────────────────────────────────────────────┐
│ VPS 1 — Canton participant + Splice validator (Docker, TestNet) │
│   - Canton JSON Ledger API :7575                                │
│   - Splice Validator App   :8080                                │
│   - Keycloak (realm "canton")                                   │
└─────────────────────────────────────────────────────────────────┘
            ▲ SSH tunnel
┌───────────┴─────────────────────────────────────────────────────┐
│ VPS 2 — NestJS API (:3001) + PostgreSQL + Redis + nginx        │
│   - CantonLedgerService (JSON Ledger API v2)                    │
│   - SpliceValidatorService (Validator REST)                     │
│   - CantexClient (api.cantex.io)                                │
└─────────────────────────────────────────────────────────────────┘
            ▲ HTTPS
┌───────────┴─────────────────────────────────────────────────────┐
│ Vercel — Next.js web (BFF proxy + SSE direct to API origin)     │
└─────────────────────────────────────────────────────────────────┘
```

### Custodial Model (Wintip-style)
CanQuest adalah **custodial dapp** — backend bertindak atas nama setiap user party via Keycloak operator token (validator-app-backend client). Tidak ada per-user wallet JWT / signing key.

- **CC/Amulet**: on-chain per user party (CanQuest operator punya `CanActAs` rights ke semua user party)
- **Token non-CC (USDCx dll)**: saat ini **off-chain** (`CantexTokenBalance` table). Token asli di shared Cantex trading account `Cantex::1220...`. On-chain delivery sedang diimplementasi (lihat §6).

### Identitas Tiga Lapis
1. **Web2 identity**: Supabase Auth (`auth.users` UUID) atau legacy bcrypt
2. **Ledger identity bridge**: Keycloak UUID (`User.keycloakId`)
3. **Canton party**: `User.cantonPartyId` (format `username::1220...`)

---

## 2. Auth & User Identity

### Dual JWT Strategy
Satu Passport strategy `jwt` menangani DUA jenis token (`apps/api/src/auth/strategies/jwt.strategy.ts`):

| Algorithm | Sumber | Verifikasi |
|-----------|--------|------------|
| **ES256** | Supabase Auth | JWKS Supabase (cache per-`kid`, support rotasi) |
| **HS256** | Legacy bcrypt | `JWT_ACCESS_SECRET` env |

- `secretOrKeyProvider` dinamis: decode JWT header → dispatch key by `alg`
- `algorithms: ['HS256', 'ES256']`, `ignoreExpiration: false`
- ES256 di-reject bila `SUPABASE_AUTH_ENABLED !== 'true'`

### Register Flow
1. Email/password validation + anti-sybil check
2. **Supabase path**: `supabase.client.auth.admin.createUser()` → `User.authUserId` (UUID) + sentinel passwordHash `'!supabase-managed:no-local-hash'`
3. **Legacy path**: bcrypt hash (rounds 12), OTP via Resend email
4. Referral resolution (`resolveReferralForEmail`, anti self-referral)

### OTP Verify
- OTP hash HMAC-SHA256 dengan salt `OTP_HMAC_SECRET || JWT_ACCESS_SECRET`
- `MAX_OTP_ATTEMPTS=5`, constant-time compare via `timingSafeEqual`
- Legacy fallback `sha256(code)` tanpa salt (TODO: remove after deploy cycle)

### SSE Token
- JWT HS256 `{sub: userId, kind:'sse'}`, TTL 60s
- Terpisah dari access token karena EventSource tidak bisa set Authorization header
- Frontend exchange via `POST /api/auth/sse-token` (BFF baca cookie httpOnly)

---

## 3. Party Allocation & Wallet Onboarding

### Tiga Jalur Onboarding

#### Jalur A (utama, Keycloak) — `POST /party/username`
```
walletOnboarding.onboardWalletForUser({username, email})
  1. keycloakAdmin.createUserAndGetId()     → UUID Keycloak
  2. spliceValidator.createWalletUser()     → party_id Splice
  3. cantonLedger.ensureLedgerUser(UUID, partyId)  → bridge Ledger API
users.setCantonIdentity(userId, {partyId, keycloakId, username})
```
- Password Keycloak acak 24-byte hex (user tidak tahu password-nya; login via CanQuest JWT)
- `assertPartyOnValidatorParticipant` cegah wallet di participant salah network

#### Jalur B (fallback) — `POST /party/allocate`
```
spliceValidator.createWalletUser(username) → splicePartyId
  ↓ bila gagal: cantonLedger.allocateParty(username) → cantonPartyId
users.setPartyId(userId, partyId, username)
```
`allocateParty` (`canton-ledger.service.ts:1668`): `POST /v2/parties` + `grantUserRights` (CanActAs + CanReadAs ke operator)

#### Jalur C (manual) — `POST /party/canton-binding`
User paste party ID, tanpa validasi ledger (hanya `assertPartyOnValidatorParticipant`).

### Placeholder Party
- Saat register (auth) tapi belum set username/wallet → `cantonPartyId` diisi placeholder prefix `canquest:`
- Guard `hasRealWallet()`: truthy AND `!partyId.startsWith("canquest:")`

### Anti-Double-Wallet (SECURITY)
- `User.cantonPartyId @unique` di DB level — menutup celah TOCTOU dari `findByPartyId`
- 1 wallet ↔ 1 account, mencegah attacker klaim reward berkali-kali via N email sharing 1 wallet

### System Party IDs (env)
| Env | Role |
|-----|------|
| `CANTON_VALIDATOR_PARTY_ID` | Validator node (provider preapproval, lock holder default) |
| `CANTON_DSO_PARTY_ID` | DSO party (admin CC/Amulet, WAJIB CIP-0056) |
| `CANTON_REWARD_PARTY_ID` | Reward sender (canquest-reward-user) |
| `CANTON_FEE_RECIPIENT_PARTY_ID` | Treasury fee (canquest-fee) |
| `CANTON_LOCK_HOLDER_PARTY` | LockedAmulet holder (fallback validator) |
| `CANTON_APP_PROVIDER_PARTY_ID` | Featured app provider |
| `CANTON_OPERATOR_PARTY_ID` | DAML operator |

### Preapproval Default: OFF
> `party.controller.ts:284-323`: "TransferPreapproval: DEFAULT OFF. JANGAN auto-create saat register — biarkan OFF supaya SEMUA CC masuk (reward/transfer/spin) jadi offer yang harus di-accept manual."

---

## 4. CC Transfer Flow (CIP-0056)

### Endpoint: `POST /party/send-cc`

#### Alur
1. **Gate**: wallet password (opsional), mutex per-user `sendCcInFlight` cegah double-send
2. **Recipient resolve**: `@username` → DB lookup → `splice.getUserPartyId()` atau langsung pakai party ID. Block transfer ke system party
3. **Balance check**: DB cache fast path
4. **CIP-0056 transfer**: `executeTransferFactoryTransfer({sender, receiver, amount, clientNonce})`
5. **Branch transferKind**:
   - `direct` (preapproval ON) → CC langsung mendarat
   - `offer` (preapproval OFF) → `AmuletTransferInstruction` pending, **NO auto-accept** (user accept manual via inbox)
6. **Fee collect** (hanya bila accepted): CIP-0056 transfer ke fee recipient. Bila fee jadi offer → **auto-accept** (satu-satunya auto-accept pattern). Non-blocking.
7. **Record**: TRANSFER_OUT sender + TRANSFER_IN recipient + `alignBalanceFromChain`

### `executeTransferFactoryTransfer` (`canton-ledger.service.ts:454`)

Generic untuk instrument APA PUN (CC + non-CC setelah generalisasi):

```typescript
async executeTransferFactoryTransfer(params: {
  senderPartyId, receiverPartyId, amountCc,
  description?, identity?: 'admin'|'reward', clientNonce?,
  instrumentId?: string,        // default 'Amulet'
  instrumentAdmin?: string,     // default CANTON_DSO_PARTY_ID
})
```

**3 Step:**
1. **Query holdings**: Amulet → `queryAmuletHoldings`, non-CC → `queryTokenHoldings` → `inputHoldingCids`
2. **Registry call**: `callTransferFactoryRegistry(choiceArguments)` → `{factoryId, choiceContextData, disclosedContracts, transferKind}`
3. **Exercise**: `TransferFactory_Transfer` (interface `#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory`), waitMode `submit-and-wait-for-transaction-tree`

### transferKind Determination
- **Bukan computed locally** — registry `transfer-factory` yang authoritative menentukan `direct` vs `offer` berdasarkan keberadaan preapproval receiver on-chain

### Idempotency
```typescript
commandId = clientNonce
  ? `tf-${sha256(sender|receiver|amount|nonce).slice(0,32)}`  // DETERMINISTIK
  : `transfer-factory-${uuid}`                                 // randomUUID (background)
```
Wajib untuk operasi user-initiated (sendCc). Background reward path pakai randomUUID.

### TransferInstruction (Two-Step) Endpoints
| Endpoint | Choice | Controller |
|----------|--------|------------|
| `POST /party/transfer-instruction/accept` | `TransferInstruction_Accept` | receiver |
| `POST /party/transfer-instruction/reject` | `TransferInstruction_Reject` | receiver (CC balik ke sender) |
| `POST /party/transfer-instruction/withdraw` | `TransferInstruction_Withdraw` | sender |

### Legacy TransferOffer (masih didukung)
- `acceptTransferOffer` / `rejectTransferOffer` — hardcoded templateId `94d88246...:Splice.Wallet.TransferOffer:TransferOffer`
- `queryPendingOffers` handle kedua jenis berdampingan

---

## 5. TransferPreapproval Lifecycle

### Status Check — `getTransferPreapprovalAuthoritative` (`canton-ledger.service.ts:883`)
**UNION 3 sumber** (false-negative lebih berbahaya dari false-positive untuk money flow):
1. Ledger receiver view (`findTransferPreapprovalContract(partyId)`)
2. Ledger provider view (`findTransferPreapprovalContract(partyId, CANTON_VALIDATOR_PARTY_ID)`)
3. Splice REST fallback

### Enable — `createTransferPreapprovalViaLedger` (`:1059`)
- Exercise `AmuletRules_CreateTransferPreapproval`
- Provider (`CANTON_VALIDATOR_PARTY_ID`) pre-pay ~1.5 CC burn fee
- expiresAt = now + 90 hari
- Pilih holding terbesar effective amount (≥ 2 CC buffer)
- actAs `[receiverPartyId, provider]`

### Disable — `cancelTransferPreapprovalViaLedger` (`:963`)
- Exercise `TransferPreapproval_Cancel`
- Coba actAs receiver dulu, fallback ke provider
- `waitForPreapprovalGone` (5 tries × 600ms polling)

### Cooldown
- User enable/disable → cooldown 7 hari (`preapprovalToggleAt`)

---

## 6. Cantex DEX Swap Flow

### Arsitektur High-Level

```
User Party (CC on-chain)          Cantex Trading Account (shared)
┌──────────────────┐              ┌──────────────────────────────┐
│ CC (Amulet)      │◄──── CC ────►│ CC + semua token Cantex      │
│ on-chain         │  CIP-0056    │ (operator Ed25519 +          │
└──────────────────┘              │  trading secp256k1 keys)     │
                                  └──────────────────────────────┘
                                            ▲
                                            │ Cantex DEX swap
                                            │ (intent flow + WS confirm)
                                            ▼
                                  ┌──────────────────────────────┐
                                  │ Cantex API (api.cantex.io)   │
                                  │ - Auth challenge-response    │
                                  │ - Pool swap via intent       │
                                  │ - WS SwapExecuted confirm    │
                                  └──────────────────────────────┘
```

### CantexClient Methods (`cantex-client.ts`)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `authenticate()` | `/v1/auth/api-key/begin` + `/finish` | Challenge-response Ed25519 → api_key |
| `getAccountInfo()` | `GET /v1/account/info` | Balance trading account (per instrument) |
| `getAccountAdmin()` | `GET /v1/account/admin` | Provisioning status (intent/trading account) |
| `createTradingAccount()` | `POST .../build/pool/create_account` | Create pool trading account (operator flow) |
| `buildAndSubmitSwap()` | `POST /v1/intent/build/pool/swap` + `/submit` | secp256k1 intent flow |
| `transferCC()` | `POST /v1/ledger/transaction/build/transfer` + `/submit` | Ed25519 operator transfer (CC-only di backend Cantex) |
| `swapAndConfirm()` | WS `/v1/ws/private` + swap | Open WS BEFORE submit, listen SwapExecuted/Failed |
| `getPools()` | `GET /v2/pools/info` | Semua pool AMM |
| `getQuote()` | `POST /v2/pools/quote` | Live swap quote |
| `getTokenPrices()` | (derive + quote) | Harga USD (USDCx=$1 anchor), cache 30s |

### Auth Flow Detail
1. `POST /v1/auth/api-key/begin` dengan `{publicKey}` (urlsafe base64 Ed25519 pubkey)
2. Sign `begin.message` (UTF-8 bytes) dengan operator Ed25519 (pure, no hash)
3. `POST /v1/auth/api-key/finish` dengan `{challengeId, signature: base64url}`
4. Cache api_key in-memory + file

### Swap Flow — CC → Token (`swapCCToToken`)
1. **Wallet password gate** + per-user mutex `swapInFlight`
2. **Idempotency**: cek `clientNonce` di SwapTransaction
3. **Balance check**: CcBalance ≥ amount + platformFee
4. **Slippage gate**: fresh quote → tolak bila slippage > `MAX_SLIPPAGE_PCT` (default 15%)
5. **Transfer CC**: user → trading account via `executeTransferFactoryTransfer` (CIP-0056, CC leg)
6. **Cantex swap**: `swapWithRetry` sell CC → buy token
   - Retry 3× (0s, 8s, 16s backoff) bila error "balance/holding/insufficient"
7. **Defense-in-depth**: verify output instrument match
8. **On-chain delivery** (Wintip-style): `tryDeliverTokenOnChain` — kirim token ke user party via `cantex.transferCC`. Fallback ke off-chain credit bila gagal
9. **Off-chain credit**: `CantexTokenBalance` increment (UI tracking)
10. **Platform fee**: user → fee recipient (non-blocking)
11. **Reconcile**: `alignBalanceFromChain`

### Swap Flow — Token → CC (`swapTokenToCC`)
1. Balance check (off-chain CantexTokenBalance)
2. Slippage gate
3. **Holding pre-check** (WARN-ONLY): `getAccountInfo` → cek on-chain holding trading account. Log drift tapi tidak blokir
4. **Cantex swap**: `swapWithRetry` sell token → buy CC
5. **Debit** CantexTokenBalance off-chain
6. **Transfer CC**: trading → user via `cantex.transferCC` (fallback off-chain credit + PendingDelivery bila gagal)
7. Platform fee dari CC output

### maxNetworkFee (Fee Spike Protection)
- Frontend kirim `maxNetworkFee = quote.networkFee × 2`
- Diteruskan end-to-end ke Cantex intent payload
- Cantex tolak swap bila fee > cap (dana user aman)

### PendingDelivery Table
Token/CC yang swap-nya sukses tapi delivery on-chain gagal:
- Status: `PENDING_APPROVAL | COMPLETED | REJECTED | REFUNDED`
- User bisa accept/reject via UI; admin bisa refund/retry
- Menggantikan silent off-chain credit (sumber drift)

### ⚠️ Limitasi On-Chain Delivery Non-CC
**Endpoint Cantex `/v1/ledger/transaction/build/transfer` HANYA support CC/Amulet.** Non-CC (USDCx dll) return 400 `ledger_transaction_build_transfer_failed`. 

Saat ini delivery non-CC fallback ke off-chain credit (token tetap di trading account, DB catat kepunyaan). On-chain delivery non-CC membutuhkan pendekatan berbeda (lihat §18).

---

## 7. Cantex Signers (Ed25519 + secp256k1)

### Dua Skema Signature

| Signer | Algorithm | Use Case |
|--------|-----------|----------|
| `OperatorKeySigner` | Ed25519 | Auth challenge + ledger transaction hash |
| `IntentTradingKeySigner` | secp256k1 ECDSA (DER) | Intent/swap digest |

### ⚠️ Aturan Base64 Kritis
| Direction | Format |
|-----------|--------|
| **OUTBOUND** (pubkey, auth sig, tx-hash sig) | `base64url` (no pad) |
| **INBOUND** transaction_hash dari server | **standard** base64 decode |

Bukti di kode:
- Pubkey: `Buffer.from(pub).toString('base64url')`
- Auth sig: `sig.toString('base64url')`
- Tx-hash decode: `Buffer.from(txHash, 'base64')` ← standard, NOT base64url

### SPKI DER Prefix (secp256k1)
23-byte hardcoded prefix untuk public key wrapping:
```
3056301006072a8648ce3d020106052b8104000a034200
```
= `SEQUENCE { SEQUENCE { OID ecPublicKey, OID secp256k1 }, BIT STRING }` + `04` + X‖Y (65 byte) → total 88 byte / 176 hex chars

### DER Signature Encoder
Format `30 <totalLen> 02 <rlen> <r> 02 <slen> <s>`. Strip leading zeros, prepend 0x00 bila high bit set. Mirror Python `ecdsa.sigencode_der`.

### Hash Initialization (WAJIB sebelum sign)
```typescript
ed.etc.sha512Sync = (...msgs) => { /* sha512 */ }     // Ed25519 butuh sha512
secp.etc.hmacSha256Sync = (key, ...msgs) => { /* hmac-sha256 */ }  // secp256k1 butuh untuk RFC6979
```

---

## 8. CC Lock Flow

### Model `CcLock`
Metadata untuk LockedAmulet on-chain. Field: `ownerParty, userId?, amountCc, termKey, lockSeconds, lockedAt, expiresAt, status ("LOCKED"|"UNLOCKED"), lockedAmuletCid?`.

**Sumber kebenaran jumlah tetap on-chain**; tabel hanya metadata + UI.

### Lock (`lockCc`, `canton-ledger.service.ts:3020`)
1. lockHolder = `CANTON_LOCK_HOLDER_PARTY || CANTON_VALIDATOR_PARTY_ID`
2. Fetch `amulet-rules` + `open-and-issuing-mining-rounds` dari scan-proxy
3. Query holdings owner, score by effective amount
4. Exercise **`AmuletRules_Transfer`** dengan output receiver = ownerParty (self-lock), `lock:{holders:[lockHolder], expiresAt}`
5. actAs `[ownerParty, lockHolder]`
6. Extract `lockedAmuletCid` via template filter `:Splice.Amulet:LockedAmulet`

### ⚠️ Context Flat vs Nested
> `canton-ledger.service.ts:3096-3100`: `AmuletRules_Transfer.context` adalah **FLAT TransferContext** (no amuletRules field), BUKAN PaymentTransferContext. Verified against `splice-amulet-0.1.18 encoders: module.js:593`.

### Ambiguous Error Recovery
Bila status 0/5xx → jangan langsung bilang gagal. Verifikasi on-chain via `verifyLockLanded`: sleep 2.5s, query `findLockedAmulets`, match via expiresAt + amount.

### Unlock (`unlockCc`)
Exercise **`LockedAmulet_OwnerExpireLockV2`**. Hanya berhasil setelah expiresAt lewat.

### Lock Eligibility (`lock-eligibility.service.ts`)
- `lockedCcOf(ownerParty)` = sum amount dari `findLockedAmulets`
- ⚠️ **Bukan `effective_locked_qty` dari Splice wallet** — itu tidak jalan di mode keycloak (`splice.getUserBalance()` return null). Substitusi: jumlahkan field amount dari LockedAmulet via `findLockedAmulets()`
- Tier: `≥ LOCK_TIER_FULL (default 30)` → FULL else NONE
- `reconcileLocksWithChain`: backfill orphan (lock on-chain tanpa DB row) + cleanup stale

---

## 9. Quest / Reward / Earn Flow

### Reward Types (enum `RewardType`)
| Type | Description | Claim Path |
|------|-------------|------------|
| `WAITLIST_EMAIL` | Admin draw, email winner | Manual |
| `INVITE_CODE_RANDOM` | Raffle untuk code | `claim-invite` |
| `INVITE_CODE_FCFS` | Code FCFS | `claim-invite` |
| `CC_ONLY` | Submit auto-enqueue CC | Auto |
| `CC_MANUAL` | Raffle CC | `claim-draw-cc` |
| `CC_AND_INVITE` | Combo | — |
| `CC_AND_CODE_RAFFLE` | Combined raffle (5 CC fee) | `claim-cc-and-code-raffle` |

### CC Reward Flow (BullMQ Jobs)
```
Quest completion → enqueueCcReward({userId, amount, referenceId})
  → BullMQ job (attempts:3, backoff exponential)
  → LedgerJobProcessor.processSendCcReward:
    1. FUND-SAFETY double-payout guard (cek existing QUEST_REWARD dengan ledgerTxId)
    2. executeTransferFactoryTransfer(sender: rewardParty, receiver: userParty)
    3. Bila offer → JANGAN auto-accept (biarkan pending)
    4. recordTransaction (QUEST_REWARD)
    5. FUND-SAFETY: bila DB record gagal SETELAH CC terkirim → JANGAN throw (cegah double-payout)
```

### FCFS Claim Flow (Race-Safe)
1. `reserveFcfsSlotLocked`: `$transaction` dengan `SELECT id FROM "Quest" WHERE id=? FOR UPDATE` (row-level lock)
2. Release stale reservations dulu
3. Cek slots taken vs maxWinners
4. `collectClaimFee` (user → fee recipient)
5. `sendReward` (reward party → user)
6. **SECURITY C1**: persist `distributed:true + ledgerTxId` IMMEDIATELY via conditional `updateMany({where:{distributed:false}})`

### Invite Code Reservation (Anti-TOCTOU)
```sql
SELECT id, code FROM "InviteCodePool"
WHERE "questId"=? AND "userId" IS NULL
ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
```
`findFirst+update` sebelumnya punya TOCTOU race — dua claim parallel baca row free yang sama.

### Earn Entry Gate
- `EarnEntry` model: 1 row per `(userId, questId)`
- `method`: `points | cc_lock | none`
- `EntryGateMode`: `CC_OR_POINTS (default) | CC_ONLY | POINTS_ONLY | NONE`

---

## 10. Balance Sync (On-chain ↔ Off-chain)

**Sumber kebenaran: on-chain. PostgreSQL = cache.**

### Tiga Service Background

#### `CcInboundSyncService` — Poll 30s
- Detect CC balance increases di Splice wallet → record `TRANSFER_IN`
- `alignBalanceFromChain(userId)`: update snapshot CcBalance tanpa create transaction
- `isExplainedByRecentAppActivity`: suppress duplicate TRANSFER_IN bila delta cocok reward+fee dalam 20 menit
- ⚠️ **Sumber balance API hanya memberi delta jumlah, BUKAN sender/CID asli** → `ledgerTxId` diset marker `inbound-sync:{partyId}:{ts}`

#### `OfferReconcilerService` — Poll 60s
- Problem: receiver accept/reject di EXTERNAL wallet → backend tidak tahu → row sender PENDING forever
- Cari row PENDING + `transferInstructionCid`, cek on-chain via `queryPendingOffers`
- Bila cid hilang → offer consumed. Bedakan accept vs reject via delta balance (heuristic)

#### `LedgerIndexerService` — Poll 15s (OFF by default)
- Pakai **Modo Transfer API** (`api.modo.link`), BUKAN ACS langsung
- Settle `CcTransaction.settledAt` + `cantonUpdateId` berdasarkan update on-chain

### `CcBalanceService` (Read)
- DB-first dengan background sync
- `BALANCE_READ_FROM_DB` (default true), `BALANCE_DB_MAX_AGE_MS` (60000)
- Stale data → schedule background sync (debounced 15s)

---

## 11. Keycloak Integration

### `KeycloakTokenService` — Client Credentials untuk Ledger API
- URL: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`
- Scope: `daml_ledger_api` (audience `https://canton.network.global`)
- **Dua identity**:
  - `getAdminLedgerToken()` — `LEDGER_CLIENT_ID/SECRET` (validator-app-backend)
  - `getRewardLedgerToken()` — `REWARD_CLIENT_ID/SECRET` atau fallback admin
- In-memory cache + single-flight via `inflight` Map (cegah thundering herd)
- Timeout 10s wajib (cegah black-hole lock bila Keycloak hang)

### `KeycloakAdminService` — User Management
- Admin token dari **realm MASTER** (admin-cli client, password grant) — BUKAN realm canton
- `createUserAndGetId()`: POST `/admin/realms/{realm}/users`, 409 = reuse existing

### actAs Rights — Cara Auth ke Ledger API
Di mode keycloak (operator), backend bertindak sebagai operator untuk setiap party. TIDAK ada per-user wallet JWT.

`SpliceValidatorService.assertAuthMode()` throw di boot bila `LEDGER_AUTH_MODE != keycloak`.

actAs di-grant via:
- `grantUserRights` (operator ledger-api-user)
- `grantLedgerUserRights` (Keycloak user sendiri)
- `grantOperatorRightsOnParty`

Saat submit command, `actAs` array di-pass. Contoh: `executeTransferFactoryTransfer` actAs `[senderPartyId]`.

---

## 12. Realtime / SSE

### RealtimeService
- In-memory registry `Map<userId, Set<Response>>`
- ⚠️ **Single PM2 instance only** — multi-instance butuh Redis adapter
- `push(userId, event, data)`: format SSE `event: <name>\ndata: <json>\n\n`. No-op bila user offline.

### RealtimeController
- `GET /api/realtime/stream?token=<sse-token>`
- Headers: `Content-Type: text/event-stream`, `X-Accel-Buffering: no`
- Heartbeat 30s (SSE comment `:heartbeat <ts>`)
- Emit `event: ready` saat connect

### Event Names
| Event | Trigger |
|-------|---------|
| `transaction:new` | `recordTransaction` saat tx COMPLETED |
| `balance:changed` | `recordTransaction` + `markTransferInstructionSettled` |
| `quest:progress` | Quest completion |
| `ready` | SSE handshake |
| `:heartbeat` | SSE comment (keep-alive) |

### SSE Bypass Vercel
> Frontend connect **langsung ke `api.canquest.cc`** (API origin, bukan via BFF Vercel) karena "Vercel serverless memutus koneksi ~10s — tidak cocok untuk SSE panjang".

nginx config khusus `/api/realtime/stream`: `proxy_buffering off`, `proxy_read_timeout 3600s`.

---

## 13. Wallet Password / PIN Gate

### Desain
- **Terpisah dari passwordHash login** — tidak pernah dipakai untuk login
- Bcrypt rounds 12, `MAX_ATTEMPTS=5`, `LOCK_MS=15 menit`
- **Opsional**: `walletPasswordHash === null` ⇒ tidak ada gate

### Timing-Enumeration Protection
User yang belum set password tetap di-compare dengan `dummyHash` (cached) supaya response time konsisten.

### assertGate — Choke-point untuk Endpoint Sensitif
```typescript
assertGate(userId, supplied?) {
  if (!hasPassword(userId)) return;  // no-op bila belum set
  r = await verify(userId, supplied ?? '')
  if (!r.ok) throw ForbiddenException(...)
}
```

### Call Sites
- `POST /party/send-cc`
- `POST /party/lock`, `POST /party/unlock`
- `POST /party/swap` (via SwapService.executeSwap)

---

## 14. Frontend Flow

### Wallet UI (3-Zona Wintip-style)
1. **Balance Hero** — total USD = (CC × ccUsd) + Σ(non-CC × price)
2. **WalletActions** — Send / Receive / Offers / Swap
3. **My Tokens** — kartu CC selalu pertama, token non-CC aktif render

### Swap Modal
- Status gate via `GET /api/party/swap/status`
- Live quote debounced 500ms
- Min amount 10 CC (hanya saat jual CC, Cantex ticket size)
- Submit dengan `clientNonce` (UUID idempotency) + `maxNetworkFee` (networkFee × 2)
- Token picker filter `ACTIVE_SWAP_TOKENS` (saat ini hanya USDCX)

### Hooks (TanStack Query)
| Hook | Endpoint | Poll Interval |
|------|----------|---------------|
| `useCcBalance` | `/api/party/balance` | 90s |
| `useLockStatus` | `/api/party/lock-status` | 45-120s |
| `useTokenPrices` | `/api/party/swap/prices` | 10s |
| `useTransactionNotifications` | `/api/party/notifications` | 120s |

### API Client Pattern
- `apiFetch<T>()`: cookie-based auth (`credentials: 'include'`)
- BFF proxy: `nestWithAccessCookie()` extract Supabase session → set `Authorization: Bearer` ke Nest
- Maintenance 503 → global event `cq:maintenance` → overlay

### Auth Flow Frontend
- Dua-mode: Supabase cookie (`sb-*-auth-token`) OR legacy `cq_access`
- Login/register via modal tunggal (5 mode: login/register/forgot/reset/OTP)
- Turnstile captcha gate
- Post-auth: redirect ke `/overview`

### Wallet Access Gating (2 Layer)
1. **Login gate** (middleware) — cookie session
2. **Wallet gate** (`hasRealWallet`) — party truthy AND `!partyId.startsWith("canquest:")`

---

## 15. Infrastructure & Deployment

### Topologi
| Komponen | Lokasi |
|----------|--------|
| Canton participant + Splice validator | VPS 1 (Docker, TestNet) |
| NestJS API + PostgreSQL + Redis + nginx | VPS 2 |
| Next.js web | Vercel |

### PM2 Config (`infra/pm2.ecosystem.config.js`)
- Single app `canquest-api`, `exec_mode: fork`, `instances: 1`
- `max_memory_restart: 512M`
- Env: load `apps/api/.env` manual via `loadEnvFile()`

### Deploy Script (`infra/redeploy.sh`)
1. `git reset --hard origin/master`
2. `rm -rf node_modules` + `npm install --legacy-peer-deps`
3. `prisma generate` + DB backup + **`prisma migrate deploy`** (bukan `db push --accept-data-loss`)
4. `npm run build`
5. Redis check
6. PM2 restart

### nginx
- Security headers, `client_max_body_size 20M`
- Default proxy :3001, buffering on, read timeout 120s
- `/api/realtime/stream`: buffering OFF, read timeout 3600s (SSE)

---

## 16. Prisma Schema Overview

### Models (20 total)
`User`, `EarnEntry`, `WalletInviteCode`, `WalletAllocationLog`, `ReferralReward`, `RefreshToken`, `PasswordReset`, `CcBalance`, `CcTransaction`, `CantexTokenBalance`, `SwapTransaction`, `PendingDelivery`, `CcLock`, `Quest`, `InviteCodePool`, `WinnerDraw`, `QuestTask`, `QuestSubmission`, `AppSetting`, `QuestCompletion`

### Enum `CcTransactionType`
```
QUEST_REWARD, SPIN_REWARD, TRANSFER_IN, TRANSFER_OUT, AIRDROP,
CC_LOCK, CC_UNLOCK, OFFER_REJECTED, OFFER_WITHDRAWN,
PREAPPROVAL_ENABLED, PREAPPROVAL_DISABLED, SWAP_OUT, SWAP_IN
```

### Unique Constraints Penting
- `User.cantonPartyId @unique` — anti-double-wallet (SECURITY)
- `User.keycloakId @unique`, `User.authUserId @unique`
- `CcTransaction @@unique([userId, ledgerTxId])` — idempotensi
- `CantexTokenBalance @@unique([userId, instrumentId, instrumentAdmin])`
- `SwapTransaction.clientNonce @unique` — idempotency swap

---

## 17. Env Config Reference

### Canton Ledger
```env
LEDGER_API_URL=https://api-ledger-canquest.nodelab.my.id
LEDGER_API_ADMIN_USER=<UUID admin Keycloak>
LEDGER_AUTH_MODE=keycloak                    # WAJIB
KEYCLOAK_URL=https://oauth-canquest.nodelab.my.id
KEYCLOAK_REALM=canton
LEDGER_API_AUTH_SCOPE=daml_ledger_api
LEDGER_CLIENT_ID=validator-app-backend
LEDGER_CLIENT_SECRET=<secret>
```

### Canton Validator
```env
CANTON_VALIDATOR_URL=https://api-canquest.nodelab.my.id
CANTON_SCAN_URL=https://api-canquest.nodelab.my.id/api/validator/v0/scan-proxy
CANTON_VALIDATOR_PARTY_ID=canquest-validator-1::1220...
CANTON_DSO_PARTY_ID=DSO::1220b1431ef217342db...
CANTON_REWARD_PARTY_ID=canquest-reward-user::1220...
CANTON_FEE_RECIPIENT_PARTY_ID=canquest-fee::1220...
CANTON_LOCK_HOLDER_PARTY=canquest-validator-1::1220...
```

### Cantex DEX
```env
CANTEX_ENABLED=true
CANTEX_API_BASE_URL=https://api.cantex.io
CANTEX_OPERATOR_KEY=<64-hex Ed25519>
CANTEX_TRADING_KEY=<64-hex secp256k1>
CANTEX_TRADING_ACCOUNT_PARTY=Cantex::1220...
CANTEX_CC_INSTRUMENT_ID=Amulet
CANTEX_CC_INSTRUMENT_ADMIN=DSO::1220...
SWAP_PLATFORM_FEE_CC=0
MAX_SLIPPAGE_PCT=15
SAFE_MIN_SWAP_CC=1
```

### Balance Sync
```env
CC_INBOUND_SYNC_ENABLED=true
CC_INBOUND_SYNC_POLL_MS=30000
OFFER_RECONCILER_ENABLED=true
OFFER_RECONCILER_POLL_MS=60000
LEDGER_INDEXER_ENABLED=false                 # OFF by default
LEDGER_INDEXER_POLL_INTERVAL_MS=15000
```

---

## 18. ⚠️ Pertanyaan untuk AI Canton Network

### Kritikal — Memblokir Fitur

**P1. On-chain delivery token non-CC (USDCx dll)**
- Endpoint Cantex `/v1/ledger/transaction/build/transfer` return 400 `ledger_transaction_build_transfer_failed` untuk non-CC. CC/Amulet jalan normal (200 OK).
- **Pertanyaan**: Apakah ada endpoint lain di Cantex API untuk transfer non-CC? Atau perlu setup receiver khusus (TransferPreapproval per-token, holding account, registry registration)?

**P2. Query holding token non-CC via Canton Ledger**
- `queryTokenHoldings` (generic, filter by `createArgument.instrument`) tidak bisa di-test karena CanQuest validator tidak punya ACS visibility ke party `Cantex::...` (403 PERMISSION_DENIED).
- **Pertanyaan**: Bagaimana cara canonical query holding token non-CC (USDCx, CBTC) di Canton Network? Apakah pakai `InterfaceFilter` dengan `Splice.Api.Token.HoldingV1:Holding`? Atau `WildcardFilter` + filter field instrument?

**P3. Template DAML holding non-CC**
- Untuk CC/Amulet: template `Splice.Amulet:Amulet` (sudah jalan)
- Untuk non-CC (USDCx bridged): template belum terverifikasi. Dokumentasi menyebut package `splice-api-token-burn-mint-v1` tapi nama template pastinya tidak ada di docs.
- **Pertanyaan**: Apa nama template DAML untuk holding token burn-mint (USDCx, CBTC)? Apakah `Splice.Api.Token.BurnMintV1:Holding`?

### Arsitektur — Perlu Konfirmasi

**P4. `transferInstructionCid` extraction**
- CanQuest extract `transferInstructionCid` dari CreatedEvent tree (bukan dari updateId) untuk offer-kind transfer.
- **Pertanyaan**: Apakah ini cara kanonik untuk dapat contract id instruction hasil offer?

**P5. `getTransferPreapprovalAuthoritative` UNION 3 sumber**
- CanQuest UNION 3 sumber: ledger receiver view + ledger provider view + Splice REST. active=true bila SALAH SATU ada.
- **Pertanyaan**: Apakah CanActAs operator pada receiver cukup untuk lihat TransferPreapproval, atau butuh CanReadAs eksplisit?

**P6. `createTransferPreapprovalViaLedger` choiceArgument shape**
- Provider (`CANTON_VALIDATOR_PARTY_ID`) pre-pay ~1.5 CC burn fee, actAs `[receiverPartyId, provider]`.
- **Pertanyaan**: Apakah `AmuletRules_CreateTransferPreapproval` benar controller = provider yang pre-pay fee?

**P7. lockCc context flat vs nested**
- `AmuletRules_Transfer.context` adalah FLAT TransferContext (bukan nested PaymentTransferContext), verified against `splice-amulet-0.1.18`.
- **Pertanyaan**: Apakah ini masih valid di MainNet package terbaru? Konfirmasi versi package MainNet aktual.

### MainNet-Specific

**P8. WildcardFilter everywhere**
- MainNet package hash rejection dari TemplateFilter menyebabkan client-side filtering berat. Performa: `queryPendingOffers` load SEMUA kontrak party lalu filter JS.
- **Pertanyaan**: Apakah Canton Ledger API v2 mendukung `InterfaceFilter` stabil untuk package Splice? Kalau ya, ini lebih efficient dari WildcardFilter.

**P9. Hardcoded templateId fragility**
- `acceptTransferOffer`/`rejectTransferOffer` hardcode templateId `94d88246...:Splice.Wallet.TransferOffer:TransferOffer`. Package hash akan berubah per upgrade MainNet.
- **Pertanyaan**: Apakah ada cara untuk resolve templateId dinamis (bukan hardcode package hash)?

**P10. Custodial / operator mode isolation**
- Semua user party di-grant CanActAs ke operator (`LEDGER_CLIENT_ID`). Tidak ada isolasi tanda tangan per-user. Audit trail bergantung pada `actAs` array per command.
- **Pertanyaan**: Apakah ini pattern yang recommended untuk dapp custodial? Atau ada best practice untuk isolasi yang lebih baik?

### Operational

**P11. Balance sync source limitation**
- `CcInboundSyncService` hanya dapat delta jumlah dari balance API, BUKAN sender/CID asli. `ledgerTxId` diset marker `inbound-sync:{partyId}:{ts}` (bukan tx explorer asli).
- **Pertanyaan**: Apakah ada endpoint Ledger API untuk dapat detail transfer IN (sender, amount, cid) per party? Lebih reliable dari polling balance delta.

**P12. Offer reconciler heuristic lemah**
- `OfferReconcilerService` bedakan accept vs reject via delta balance (`onChain < before - amount*0.5` → COMPLETED else REJECTED). Fallback COMPLETED bila balance unavailable.
- **Pertanyaan**: Apakah ada webhook/event dari Canton saat TransferInstruction di-accept/reject? Atau endpoint untuk query status instruction by cid?

---

## 19. 🐛 Known Issues & Technical Debt

### Bug Aktif

**B1. Cantex non-CC transfer tidak support**
- Endpoint `/v1/ledger/transaction/build/transfer` return 400 untuk non-CC. On-chain delivery non-CC fallback ke off-chain (token tetap di trading account).

**B2. `Pool.SwapFailed` error kosong**
- Cantex sering kirim `Pool.SwapFailed` dengan field `error` kosong → user lihat "Swap failed: unknown". Sudah di-fix dengan log full payload, tapi root cause belum diketahui.

### Technical Debt

**D1. Legacy code paths retained for rollback**
- Banyak method AuthService dianotasi "(LEGACY path)" — `login`, `refresh`, `forgotPassword`, `resetPassword`, `verifyOtp`. Dipertahankan untuk rollback ke HS256 bila Supabase bermasalah.
- `TODO: remove legacy OTP fallback after one deploy cycle` (`auth.service.ts:349`)

**D2. `User.passwordHash` akan di-drop Phase 6**
- Kolom NOT NULL, sementara diisi sentinel `'!supabase-managed:no-local-hash'`. Hash asli ada di `auth.users` Supabase.

**D3. `JOB_ACCEPT_OFFER` no-op**
- Legacy Splice per-user offer flow dihapus. Job di queue lama tidak throw agar tidak retry.

**D4. Audit-trail loss window**
- Karena pola "CC sudah pergi, DB record gagal = tidak throw", ada window transient:
  - Balance di CcBalance tidak sinkron (self-heal ≤30s via cc-inbound-sync)
  - History row MISSING — reconcile manual dari log `AUDIT-TRAIL LOSS`

**D5. Multi-instance limitation**
- `RealtimeService` registry in-memory hanya untuk single PM2 instance. Multi-instance butuh Redis adapter.
- `sendCcInFlight` mutex per-process; multi-instance butuh `Redis SET NX`.

**D6. `ACTIVE_SWAP_TOKENS` duplikasi konstanta**
- Didefinisikan 2× di `token-list.tsx:16` + `swap-modal.tsx:18`. Risk desync.

**D7. Build quality — ESLint/TypeScript ignored**
- `next.config.ts`: `eslint.ignoreDuringBuilds: true` + `typescript.ignoreBuildErrors: true`. Build tidak catch lint/TS error.

**D8. Accessibility issue**
- `app/layout.tsx:43`: `maximum-scale=1, user-scalable=no` (block zoom mobile)

### Fund-Safety Patterns (by design, bukan bug)
- **Double-payout guard**: cek existing tx sebelum kirim reward (BullMQ retry)
- **Audit-trail loss recovery**: CC sudah pergi, DB record gagal → log alert, balance self-heal ≤30s
- **TOCTOU hardening**: `cantonPartyId @unique`, `SELECT FOR UPDATE`, `FOR UPDATE SKIP LOCKED`

---

## Dokumentasi Pendukung di Repo

- `docs/NETWORK_TOPOLOGY.md`
- `docs/MAINNET_DEPLOY_CANQUEST_v10.md`
- `docs/MAINNET_MIGRATION_GUIDE.md`
- `docs/MIGRATION_KEYCLOAK_PUBLIC_API.md`
- `docs/CANTON_TRANSFER_OFFER_FLOW.md`
- `docs/DAML_CONTRACTS_DOCUMENTATION.md`
- `docs/ONCHAIN_TRANSACTION_EXPLORER.md`
- `docs/AUDIT_DAML_MAINNET_REPORT.md`
- `docs/SWAP_SETUP.md`
- `CREATE_PREAPPROVAL_LEDGER_INVESTIGATION.md`
- `PREAPPROVAL_LEDGER_MIGRATION_PLAN.md`
- `REWARD_CIP56_MIGRATION_ANALYSIS.md`
- `ONE_STEP_TOGGLE_AUDIT.md`

---

*Dokumen ini di-generate dari audit codebase CanQuest pada Juli 2026. Untuk pertanyaan teknis spesifik, refer ke file:line yang dicantumkan.*
